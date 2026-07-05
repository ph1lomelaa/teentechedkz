from __future__ import annotations
import math
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.student_task import StudentTask, TaskStatus
from app.models.student import Student
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("")
async def list_all_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    status: str | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
):
    """Return all tasks the current user can see, with student name included."""
    query = select(StudentTask).options(joinedload(StudentTask.student))

    if current_user.role in (UserRole.lead_mentor, UserRole.mentor):
        assigned = await db.execute(
            select(MentorAssignment.student_id).where(
                MentorAssignment.mentor_id == current_user.id,
                MentorAssignment.is_active == True,  # noqa: E712
            )
        )
        student_ids = [row[0] for row in assigned.all()]
        if not student_ids:
            return {"items": [], "total": 0, "page": page, "size": size, "pages": 0}
        query = query.where(StudentTask.student_id.in_(student_ids))

    if status and status in ("open", "done"):
        query = query.where(StudentTask.status == TaskStatus(status))

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.order_by(StudentTask.created_at.desc()).offset((page - 1) * size).limit(size)
    result = await db.execute(query)
    tasks = result.scalars().all()

    return {
        "items": [_task_to_dict(t, include_student=True) for t in tasks],
        "total": total,
        "page": page,
        "size": size,
        "pages": math.ceil(total / size) if total > 0 else 0,
    }


@router.get("/student/{student_id}")
async def get_tasks(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(StudentTask)
        .where(StudentTask.student_id == student_id)
        .order_by(StudentTask.created_at.desc())
    )
    tasks = result.scalars().all()
    return [_task_to_dict(t) for t in tasks]


@router.post("")
async def create_task(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.lead_mentor):
        raise HTTPException(status_code=403, detail="Access denied")

    task = StudentTask(
        student_id=uuid.UUID(body["student_id"]),
        task_text=body.get("task_text", "").strip(),
        created_by=current_user.id,
        status=TaskStatus.open,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


@router.patch("/{task_id}")
async def update_task(
    task_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(StudentTask).where(StudentTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    if "task_text" in body:
        task.task_text = body["task_text"]

    if "status" in body:
        try:
            new_status = TaskStatus(body["status"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")
        task.status = new_status
        if new_status == TaskStatus.done and not task.done_at:
            task.done_at = datetime.now(timezone.utc)
        elif new_status == TaskStatus.open:
            task.done_at = None

    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


@router.delete("/{task_id}")
async def delete_task(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(StudentTask).where(StudentTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    await db.delete(task)
    await db.commit()
    return {"message": "Deleted"}


def _task_to_dict(t: StudentTask, include_student: bool = False) -> dict:
    d = {
        "id": str(t.id),
        "student_id": str(t.student_id),
        "task_text": t.task_text,
        "created_by": str(t.created_by),
        "status": t.status.value,
        "created_at": t.created_at.isoformat(),
        "done_at": t.done_at.isoformat() if t.done_at else None,
    }
    if include_student and t.student:
        d["student_name"] = t.student.full_name
    return d
