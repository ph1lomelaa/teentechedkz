from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.user import UserRole

router = APIRouter(prefix="/mentor-assignments", tags=["mentor_assignments"])


def _require_admin_mzk(user):
    if user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")


@router.get("/student/{student_id}")
async def get_assignments(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.student_id == student_id)
    )
    assignments = result.scalars().all()
    return [_ma_to_dict(a) for a in assignments]


@router.post("/student/{student_id}/self")
async def assign_self(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.mentor_id == current_user.id,
        )
    )
    ma = result.scalar_one_or_none()
    if ma:
        ma.is_active = True
    else:
        ma = MentorAssignment(
            student_id=student_id,
            mentor_id=current_user.id,
            role=MentorRole.lead,
            is_active=True,
        )
        db.add(ma)
    await db.commit()
    await db.refresh(ma)
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.id == ma.id)
    )
    return _ma_to_dict(result.scalar_one())


@router.patch("/student/{student_id}/self")
async def update_self_assignment(
    student_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.mentor_id == current_user.id,
        )
    )
    ma = result.scalar_one_or_none()
    if not ma:
        raise HTTPException(status_code=404, detail="Назначение не найдено")
    if "is_active" in body:
        ma.is_active = bool(body["is_active"])
    await db.commit()
    await db.refresh(ma)
    return _ma_to_dict(ma)


@router.post("")
async def create_assignment(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)
    try:
        role = MentorRole(body.get("role", "lead"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная роль ментора")

    ma = MentorAssignment(
        student_id=uuid.UUID(body["student_id"]),
        mentor_id=uuid.UUID(body["mentor_id"]),
        role=role,
        country_scope=body.get("country_scope"),
        is_active=body.get("is_active", True),
    )
    db.add(ma)
    await db.commit()
    await db.refresh(ma)
    return _ma_to_dict(ma)


@router.patch("/{assignment_id}")
async def update_assignment(
    assignment_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)
    result = await db.execute(select(MentorAssignment).where(MentorAssignment.id == assignment_id))
    ma = result.scalar_one_or_none()
    if not ma:
        raise HTTPException(status_code=404, detail="Назначение не найдено")

    if "is_active" in body:
        ma.is_active = body["is_active"]
    if "country_scope" in body:
        ma.country_scope = body["country_scope"]
    if "role" in body:
        try:
            ma.role = MentorRole(body["role"])
        except ValueError:
            pass

    await db.commit()
    await db.refresh(ma)
    return _ma_to_dict(ma)


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)
    result = await db.execute(select(MentorAssignment).where(MentorAssignment.id == assignment_id))
    ma = result.scalar_one_or_none()
    if not ma:
        raise HTTPException(status_code=404, detail="Назначение не найдено")
    await db.delete(ma)
    await db.commit()
    return {"message": "Deleted"}


def _ma_to_dict(a: MentorAssignment) -> dict:
    return {
        "id": str(a.id),
        "student_id": str(a.student_id),
        "mentor_id": str(a.mentor_id),
        "mentor_name": a.mentor.name if getattr(a, "mentor", None) else None,
        "role": a.role.value,
        "country_scope": a.country_scope,
        "is_active": a.is_active,
        "assigned_at": a.assigned_at.isoformat(),
    }
