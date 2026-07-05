from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mentor_assignment import MentorAssignment
from app.models.user import User, UserRole


async def mentor_assigned_student_ids(db: AsyncSession, user: User) -> set[uuid.UUID] | None:
    """None means "no scoping needed" (admin/mzk_manager see everything).
    A set (possibly empty) means the caller must be restricted to it."""
    if user.role != UserRole.mentor:
        return None
    result = await db.execute(
        select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == user.id,
            MentorAssignment.is_active == True,  # noqa
        )
    )
    return {r[0] for r in result.all()}


async def require_student_access(db: AsyncSession, student_id: uuid.UUID, user: User) -> None:
    """Raises if a mentor tries to touch a student outside their assignments."""
    allowed_ids = await mentor_assigned_student_ids(db, user)
    if allowed_ids is None:
        return
    if student_id not in allowed_ids:
        raise HTTPException(status_code=404, detail="Студент не найден")
