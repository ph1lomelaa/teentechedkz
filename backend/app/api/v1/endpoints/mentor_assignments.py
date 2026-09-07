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


async def _load_assignable_mentor(db: AsyncSession, mentor_id: uuid.UUID) -> User:
    """Найти сотрудника, которого вообще можно назначить ответственным."""
    mentor = (await db.execute(select(User).where(User.id == mentor_id))).scalar_one_or_none()
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
    return mentor


async def _assign_one(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    mentor_id: uuid.UUID,
    role: MentorRole,
    replacement_reason: str,
    actor_id: uuid.UUID,
    assignment_status: str,
    country_scope=None,
    functional_zone=None,
    first_task_due_date: date | None = None,
    is_active: bool = True,
) -> tuple[str, MentorAssignment | None]:
    """Назначить одного студента одному специалисту.

    Возвращает исход, а не бросает исключение на «нужна причина»: в массовом
    назначении отказ по одному студенту не должен ронять всю пачку — иначе
    двадцать корректных назначений теряются из-за одного, у которого уже есть
    ответственный. Одиночная ручка превращает исход обратно в 422 сама.

    Коммит — на вызывающем: пачка коммитится один раз, целиком.
    """
    # Строка на этого же специалиста уже есть — переиспользуем её.
    #
    # Уникального индекса на (student_id, mentor_id, role) нет, а запрос ниже
    # ищет «прежнего» с условием `mentor_id != mentor_id`, то есть того же
    # ментора он не видит: без этой ветки повторное назначение молча писало
    # вторую строку, и в «Ответственных» ментор двоился. Раньше поймать это было
    # трудно (назначали по одному из карточки), а с массовым назначением
    # «выделить всех и назначить» это обычный случай.
    #
    # Снятое назначение (is_active=False) не пропускаем мимо, а включаем
    # обратно — ровно так же ведёт себя `assign_self` выше. Иначе «взял → снял →
    # назначили заново» оставляло бы у студента две строки на одного человека.
    same_result = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.mentor_id == mentor_id,
        )
    )
    same = same_result.scalars().first()
    if same is not None:
        if same.is_active:
            return "already", same
        same.is_active = True
        same.assignment_status = assignment_status
        return "created", same

    active_result = await db.execute(
        select(MentorAssignment)
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.assignment_status != "required",
            MentorAssignment.mentor_id != mentor_id,
        )
        .with_for_update()
    )
    previous = active_result.scalar_one_or_none()
    if previous and not replacement_reason.strip():
        return "needs_reason", None

    outcome = "created"
    if previous:
        previous.is_active = False
        previous.assignment_status = "replaced"
        db.add(MentorAssignmentHistory(
            student_id=previous.student_id,
            role=previous.role.value,
            previous_mentor_id=previous.mentor_id,
            replacement_mentor_id=mentor_id,
            reason=replacement_reason.strip(),
            changed_by=actor_id,
        ))
        outcome = "replaced"

    required_result = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.assignment_status == "required",
            MentorAssignment.mentor_id.is_(None),
        )
    )
    ma = required_result.scalar_one_or_none()
    if ma:
        ma.mentor_id = mentor_id
        ma.country_scope = country_scope
        ma.functional_zone = functional_zone
        ma.first_task_due_date = first_task_due_date
        ma.assignment_status = assignment_status
        ma.is_active = is_active
    else:
        ma = MentorAssignment(
            student_id=student_id,
            mentor_id=mentor_id,
            role=role,
            country_scope=country_scope,
            functional_zone=functional_zone,
            first_task_due_date=first_task_due_date,
            assignment_status=assignment_status,
            is_active=is_active,
        )
        db.add(ma)
    return outcome, ma


def _parse_role(raw) -> MentorRole:
    try:
        return MentorRole(raw or "lead")
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная роль ментора")


@router.post("")
async def create_assignment(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
    role = _parse_role(body.get("role"))

    mentor_id = required_uuid(body, "mentor_id")
    mentor = await _load_assignable_mentor(db, mentor_id)

    first_task_due_date = None
    if body.get("first_task_due_date"):
        try:
            first_task_due_date = date.fromisoformat(body["first_task_due_date"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный срок первой задачи")

    assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, mentor) else "active"
    outcome, ma = await _assign_one(
        db,
        student_id=required_uuid(body, "student_id"),
        mentor_id=mentor_id,
        role=role,
        replacement_reason=body.get("replacement_reason") or "",
        actor_id=current_user.id,
        assignment_status=assignment_status,
        country_scope=body.get("country_scope"),
        functional_zone=body.get("functional_zone"),
        first_task_due_date=first_task_due_date,
        is_active=body.get("is_active", True),
    )
    if outcome == "needs_reason":
        raise HTTPException(status_code=422, detail="Для замены специалиста укажите причину")
    await db.commit()
    # mentor нужен для _ma_to_dict — грузим его явно (иначе ленивая загрузка в
    # async-контексте падает с MissingGreenlet).
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.id == ma.id)
    )
    return _ma_to_dict(result.scalar_one())


# Потолок на пачку: назначение пишет строку истории на каждую замену, и
# неограниченный список — это неограниченная транзакция под `with_for_update`.
MAX_BULK_ASSIGN = 200


@router.post("/bulk")
async def bulk_assign(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Назначить одного специалиста сразу нескольким студентам.

    Зачем
    -----
    Раньше назначить ответственного можно было только зайдя в карточку
    студента — на распределении набора это десятки переходов, и на практике
    ответственные просто не проставлялись. В общей базе видно, у кого их нет,
    и назначать логично прямо оттуда.

    Частичный успех — норма, а не ошибка
    ------------------------------------
    Студент, у которого уже есть активный ответственный этой роли, требует
    причины замены (см. `_assign_one`). Валить из-за него всю пачку нельзя:
    остальные назначения корректны. Поэтому такие студенты возвращаются в
    `skipped`, а фронт переспрашивает причину и повторяет запрос только для них.
    """
    require_access(current_user, "mentor_assignments", Action.manage)
    role = _parse_role(body.get("role"))

    raw_ids = body.get("student_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise HTTPException(status_code=422, detail="Выберите студентов")
    if len(raw_ids) > MAX_BULK_ASSIGN:
        raise HTTPException(
            status_code=422, detail=f"За один раз можно назначить не больше {MAX_BULK_ASSIGN} студентов"
        )
    try:
        # dict.fromkeys, а не set: порядок сохраняется, и ответ читается в том
        # же порядке, в каком студенты выбраны в таблице.
        student_ids = list(dict.fromkeys(uuid.UUID(str(sid)) for sid in raw_ids))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверный идентификатор студента")

    mentor_id = required_uuid(body, "mentor_id")
    mentor = await _load_assignable_mentor(db, mentor_id)
    # Один раз на пачку, а не на каждого студента: статус зависит от специалиста,
    # а он для всей пачки один.
    assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, mentor) else "active"
    replacement_reason = body.get("replacement_reason") or ""

    assigned = replaced = already = 0
    skipped: list[dict] = []
    for student_id in student_ids:
        outcome, _ = await _assign_one(
            db,
            student_id=student_id,
            mentor_id=mentor_id,
            role=role,
            replacement_reason=replacement_reason,
            actor_id=current_user.id,
            assignment_status=assignment_status,
        )
        if outcome == "needs_reason":
            skipped.append({"student_id": str(student_id), "reason": "needs_reason"})
        elif outcome == "replaced":
            replaced += 1
        elif outcome == "already":
            already += 1
        else:
            assigned += 1

    await db.commit()
    return {
        "assigned": assigned,
        "replaced": replaced,
        # Уже были назначены на этого специалиста — не ошибка и не работа.
        # Отдельным числом, чтобы «назначено: 3» из двадцати не выглядело сбоем.
        "already": already,
        "skipped": skipped,
        "assignment_status": assignment_status,
    }


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
