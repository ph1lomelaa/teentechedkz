"""University catalog — readable by authenticated users, additions by all staff.

Catalog data comes from staff entries and two imported sources (Tilda store +
Google Sheets) — see app/services/university_import.py for why a plain
name-string merge between the two isn't reliable and what the import does
about it (fuzzy match with a threshold, ambiguous pairs surfaced for review).
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, AsyncSessionLocal
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
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

# Every staff member can add a university; managing existing rows and
# importing the whole catalog remain separate permissions.
_IMPORT_JOB_KIND = "university_import"


@router.get("", response_model=list[UniversityOut])
async def list_universities(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    res = await db.execute(select(University).order_by(University.name))
    unis = list(res.scalars().all())
    await attach_flags(db, unis)
    return unis


@router.post("", response_model=UniversityOut, status_code=201)
async def create_university(body: UniversityCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    require_access(current_user, "universities", Action.create)
    from difflib import SequenceMatcher
    import re
    import unicodedata

    def norm(value: str) -> str:
        value = "".join(ch for ch in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(ch))
        return re.sub(r"[^\w]+", " ", value).strip()

    def acronym(value: str) -> str:
        return "".join(word[0] for word in norm(value).split() if word not in {"the", "of", "and", "at", "in"})

    def same_name(existing_name: str) -> bool:
        other = norm(existing_name)
        return (other == name or SequenceMatcher(None, other, name).ratio() >= 0.92
                or (len(name.replace(" ", "")) > 1 and name.replace(" ", "") == acronym(existing_name))
                or (len(other.replace(" ", "")) > 1 and other.replace(" ", "") == acronym(body.name)))

    name = norm(body.name)
    country = norm(body.country_name or "")
    if not name:
        raise HTTPException(status_code=422, detail="Укажите название университета")
    # Serialize identical names so concurrent staff additions do not duplicate
    # the same university. The lock is released by commit/rollback.
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:name))"), {"name": f"university:{name}"})
    existing = (await db.execute(select(University))).scalars().all()
    similar = [u for u in existing if (not country or norm(u.country_name or "") == country) and
               same_name(u.name)]
    if similar:
        raise HTTPException(status_code=409, detail={
            "message": "Похожий университет уже есть в каталоге",
            "matches": [{"id": str(u.id), "name": u.name, "country": u.country_name} for u in similar[:5]],
        })
    uni = University(**body.model_dump())
    db.add(uni)
    await db.commit()
    await db.refresh(uni)
    await attach_flags(db, uni)
    return uni


@router.patch("/{uni_id}", response_model=UniversityOut)
async def update_university(uni_id: uuid.UUID, body: UniversityUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    require_access(current_user, "universities", Action.manage)
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
    require_access(current_user, "universities", Action.manage)
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
    require_access(current_user, "university_import", Action.create)
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
    require_access(current_user, "university_import", Action.create)
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
