from __future__ import annotations
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.body import required_uuid
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.mentor_assignment_history import MentorAssignmentHistory
from app.models.user import User, UserRole
from app.services.agreements import has_pending_agreement_signature

router = APIRouter(prefix="/mentor-assignments", tags=["mentor_assignments"])


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


@router.get("/student/{student_id}/history")
async def get_assignment_history(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
    result = await db.execute(
        select(MentorAssignmentHistory)
        .where(MentorAssignmentHistory.student_id == student_id)
        .order_by(MentorAssignmentHistory.created_at.desc())
    )
    return [
        {
            "id": str(item.id),
            "student_id": str(item.student_id),
            "role": item.role,
            "previous_mentor_id": str(item.previous_mentor_id) if item.previous_mentor_id else None,
            "replacement_mentor_id": str(item.replacement_mentor_id) if item.replacement_mentor_id else None,
            "reason": item.reason,
            "changed_by": str(item.changed_by),
            "created_at": item.created_at.isoformat(),
        }
        for item in result.scalars()
    ]


@router.post("/student/{student_id}/self")
async def assign_self(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == MentorRole.lead,
            (MentorAssignment.mentor_id == current_user.id) | (MentorAssignment.mentor_id.is_(None)),
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
    ma.assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, current_user) else "active"
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
    require_access(current_user, "mentor_assignments", Action.manage)
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
    # mentor нужен для _ma_to_dict — грузим его явно (refresh не подтягивает
    # связь, а ленивая загрузка в async-контексте падает с MissingGreenlet).
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.id == ma.id)
    )
    return _ma_to_dict(result.scalar_one())


@router.post("")
async def create_assignment(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
    try:
        role = MentorRole(body.get("role", "lead"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная роль ментора")

    mentor_id = required_uuid(body, "mentor_id")
    mentor_result = await db.execute(select(User).where(User.id == mentor_id))
    mentor = mentor_result.scalar_one_or_none()
    if not mentor:
        raise HTTPException(status_code=404, detail="Специалист не найден")
    # Админ здесь наравне с ментором и МЗК: в небольшой команде он ведёт
    # студентов сам, а прежнее правило это запрещало — он не мог взять
    # студента даже себе. Доступа это не добавляет: админ и так видит всех
    # (mentor_scope.py: скоуп применяется только к роли mentor). Меняется
    # ровно одно — он становится видимым ответственным в карточке и в
    # «Кто за что отвечает», то есть система начинает записывать то, что и
    # так происходит. На деньги не влияет: вознаграждение заводится вручную
    # с явным mentor_id (mentor_rewards.py), а не выводится из назначений.
    if mentor.role not in (UserRole.admin, UserRole.mentor, UserRole.mzk_manager):
        raise HTTPException(
            status_code=422, detail="Назначить можно только сотрудника"
        )
    active_result = await db.execute(
        select(MentorAssignment)
        .where(
            MentorAssignment.student_id == required_uuid(body, "student_id"),
            MentorAssignment.role == role,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.assignment_status != "required",
            MentorAssignment.mentor_id != mentor_id,
        )
        .with_for_update()
    )
    previous = active_result.scalar_one_or_none()
    if previous and not (body.get("replacement_reason") or "").strip():
        raise HTTPException(status_code=422, detail="Для замены специалиста укажите причину")
    if previous:
        previous.is_active = False
        previous.assignment_status = "replaced"
        db.add(MentorAssignmentHistory(
            student_id=previous.student_id,
            role=previous.role.value,
            previous_mentor_id=previous.mentor_id,
            replacement_mentor_id=mentor_id,
            reason=body["replacement_reason"].strip(),
            changed_by=current_user.id,
        ))
    assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, mentor) else "active"
    first_task_due_date = None
    if body.get("first_task_due_date"):
        try:
            first_task_due_date = date.fromisoformat(body["first_task_due_date"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный срок первой задачи")

    required_result = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == uuid.UUID(body["student_id"]),
            MentorAssignment.role == role,
            MentorAssignment.assignment_status == "required",
            MentorAssignment.mentor_id.is_(None),
        )
    )
    ma = required_result.scalar_one_or_none()
    if ma:
        ma.mentor_id = mentor_id
        ma.country_scope = body.get("country_scope")
        ma.functional_zone = body.get("functional_zone")
        ma.first_task_due_date = first_task_due_date
        ma.assignment_status = assignment_status
        ma.is_active = body.get("is_active", True)
    else:
        ma = MentorAssignment(
            student_id=uuid.UUID(body["student_id"]),
            mentor_id=mentor_id,
            role=role,
            country_scope=body.get("country_scope"),
            functional_zone=body.get("functional_zone"),
            first_task_due_date=first_task_due_date,
            assignment_status=assignment_status,
            is_active=body.get("is_active", True),
        )
        db.add(ma)
    await db.commit()
    # mentor нужен для _ma_to_dict — грузим его явно (иначе ленивая загрузка в
    # async-контексте падает с MissingGreenlet).
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.id == ma.id)
    )
    return _ma_to_dict(result.scalar_one())


@router.patch("/{assignment_id}")
async def update_assignment(
    assignment_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
    result = await db.execute(select(MentorAssignment).where(MentorAssignment.id == assignment_id))
    ma = result.scalar_one_or_none()
    if not ma:
        raise HTTPException(status_code=404, detail="Назначение не найдено")

    if "is_active" in body:
        ma.is_active = body["is_active"]
    if "mentor_id" in body and body["mentor_id"]:
        new_mentor_id = uuid.UUID(body["mentor_id"])
        if new_mentor_id != ma.mentor_id:
            reason = (body.get("replacement_reason") or "").strip()
            if not reason:
                raise HTTPException(status_code=422, detail="Для замены специалиста укажите причину")
            new_mentor = await db.get(User, new_mentor_id)
            if not new_mentor or not new_mentor.is_active or new_mentor.role not in (UserRole.mentor, UserRole.mzk_manager):
                raise HTTPException(status_code=422, detail="Новый специалист недоступен")
            old_mentor_id = ma.mentor_id
            ma.mentor_id = new_mentor_id
            ma.assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, new_mentor) else "active"
            db.add(MentorAssignmentHistory(
                student_id=ma.student_id,
                role=ma.role.value,
                previous_mentor_id=old_mentor_id,
                replacement_mentor_id=new_mentor_id,
                reason=reason,
                changed_by=current_user.id,
            ))
    if "country_scope" in body:
        ma.country_scope = body["country_scope"]
    if "functional_zone" in body:
        ma.functional_zone = body["functional_zone"]
    if "first_task_due_date" in body:
        try:
            ma.first_task_due_date = date.fromisoformat(body["first_task_due_date"]) if body["first_task_due_date"] else None
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный срок первой задачи")
    if "role" in body:
        try:
            ma.role = MentorRole(body["role"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная роль ментора")

    assignee_result = await db.execute(select(User).where(User.id == ma.mentor_id))
    assignee = assignee_result.scalar_one()
    ma.assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, assignee) else "active"

    await db.commit()
    # mentor нужен для _ma_to_dict — грузим его явно (refresh не подтягивает
    # связь, а ленивая загрузка в async-контексте падает с MissingGreenlet).
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.id == ma.id)
    )
    return _ma_to_dict(result.scalar_one())


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
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
        "mentor_id": str(a.mentor_id) if a.mentor_id else None,
        "mentor_name": a.mentor.name if getattr(a, "mentor", None) else None,
        "role": a.role.value,
        "country_scope": a.country_scope,
        "functional_zone": a.functional_zone,
        "first_task_due_date": a.first_task_due_date.isoformat() if a.first_task_due_date else None,
        "assignment_status": a.assignment_status,
        "is_active": a.is_active,
        "assigned_at": a.assigned_at.isoformat(),
    }
