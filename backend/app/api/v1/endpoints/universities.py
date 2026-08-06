"""University catalog — readable by any authenticated user, managed by admin/mzk.

Catalog data is imported from two real sources (Tilda store + Google Sheets),
not hand-entered — see app/services/university_import.py for why a plain
name-string merge between the two isn't reliable and what the import does
about it (fuzzy match with a threshold, ambiguous pairs surfaced for review).
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, AsyncSessionLocal
from app.core.deps import CurrentUser
from app.models.user import UserRole
from app.models.university import University
from app.schemas.university import (
    UniversityOut,
    UniversityDetailOut,
    UniversityCreate,
    UniversityUpdate,
)
from app.services.country_flags import attach_flags
from app.services import background_jobs

router = APIRouter(prefix="/universities", tags=["universities"])

# Catalog writes are admin/mzk only: a mentor deleting a row removes that
# university for every student at once. Mentors keep full read access.
ADMIN = (UserRole.admin, UserRole.mzk_manager)
_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_IMPORT_JOB_KIND = "university_import"


def _assert_admin(user) -> None:
    if user.role not in ADMIN:
        raise _FORBIDDEN


@router.get("", response_model=list[UniversityOut])
async def list_universities(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    res = await db.execute(select(University).order_by(University.name))
    unis = list(res.scalars().all())
    await attach_flags(db, unis)
    return unis


@router.post("", response_model=UniversityOut, status_code=201)
async def create_university(body: UniversityCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_admin(current_user)
    uni = University(**body.model_dump())
    db.add(uni)
    await db.commit()
    await db.refresh(uni)
    await attach_flags(db, uni)
    return uni


@router.patch("/{uni_id}", response_model=UniversityOut)
async def update_university(uni_id: uuid.UUID, body: UniversityUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_admin(current_user)
    uni = await db.get(University, uni_id)
    if not uni:
        raise HTTPException(status_code=404, detail="Университет не найден")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(uni, field, value)
    await db.commit()
    await db.refresh(uni)
    await attach_flags(db, uni)
    return uni


@router.delete("/{uni_id}", status_code=204)
async def delete_university(uni_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_admin(current_user)
    uni = await db.get(University, uni_id)
    if not uni:
        raise HTTPException(status_code=404, detail="Университет не найден")
    await db.delete(uni)
    await db.commit()


# --------------------------------------------------------------------------
# Import from Tilda (photos/descriptions/degrees) + Google Sheets (tuition/
# deadlines/links) — admin-only, background job, same pattern as
# /knowledge-articles/sync/notion. Re-runnable to refresh existing records.
# --------------------------------------------------------------------------
@router.post("/import/run", status_code=202)
async def start_university_import(current_user: CurrentUser, dry_run: bool = False):
    if current_user.role != UserRole.admin:
        raise _FORBIDDEN
    running = await background_jobs.get_running_job(_IMPORT_JOB_KIND)
    if running:
        raise HTTPException(status_code=409, detail={"message": "Импорт уже запущен", "job_id": str(running.id)})

    job = await background_jobs.create_job(_IMPORT_JOB_KIND, request={"dry_run": dry_run})

    async def runner() -> None:
        from app.services.university_import import import_universities

        db = AsyncSessionLocal()
        try:
            report = await import_universities(db, dry_run=dry_run)
            await background_jobs.finish_job(job.id, status="done", result=asdict(report))
        except Exception as exc:
            await background_jobs.finish_job(job.id, status="failed", error=str(exc))
        finally:
            await db.close()

    asyncio.create_task(runner())
    return background_jobs.serialize(job)


@router.get("/import/{job_id}")
async def get_university_import_job(job_id: str, current_user: CurrentUser):
    if current_user.role != UserRole.admin:
        raise _FORBIDDEN
    job = await background_jobs.get_job(_IMPORT_JOB_KIND, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Не найдено")
    return background_jobs.serialize(job)


# Declared after /import/* so those literal paths win; the uuid type on the
# parameter also keeps "/import/run" from ever matching here.
@router.get("/{uni_id}", response_model=UniversityDetailOut)
async def get_university(
    uni_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]
):
    uni = await db.get(University, uni_id)
    if not uni:
        raise HTTPException(status_code=404, detail="Университет не найден")
    await attach_flags(db, uni)
    return uni
