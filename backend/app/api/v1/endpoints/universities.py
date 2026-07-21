"""University catalog — readable by any authenticated user, managed by admin/mzk."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.user import UserRole
from app.models.university import University
from app.schemas.university import UniversityOut, UniversityCreate, UniversityUpdate
from app.services.country_flags import attach_flags

router = APIRouter(prefix="/universities", tags=["universities"])

ADMIN = (UserRole.admin, UserRole.mzk_manager)
_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})


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
