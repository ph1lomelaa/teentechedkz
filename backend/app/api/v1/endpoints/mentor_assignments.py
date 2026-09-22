from __future__ import annotations
import uuid
from collections import defaultdict
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
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
    items = result.scalars().all()
    # Имена одним запросом: история показывается людям, а не идентификаторы.
    user_ids = {
        uid
        for item in items
        for uid in (item.previous_mentor_id, item.replacement_mentor_id, item.changed_by)
        if uid is not None
    }
    names: dict = {}
    if user_ids:
        rows = await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))
        names = dict(rows.all())
    return [
        {
            "id": str(item.id),
            "student_id": str(item.student_id),
            "role": item.role,
            "previous_mentor_id": str(item.previous_mentor_id) if item.previous_mentor_id else None,
            "previous_mentor_name": names.get(item.previous_mentor_id),
            "replacement_mentor_id": str(item.replacement_mentor_id) if item.replacement_mentor_id else None,
            "replacement_mentor_name": names.get(item.replacement_mentor_id),
            "reason": item.reason,
            "changed_by": str(item.changed_by) if item.changed_by else None,
            "changed_by_name": names.get(item.changed_by),
            "created_at": item.created_at.isoformat(),
        }
        for item in items
    ]


def self_assign_role(user: User) -> MentorRole:
    """Роль, в которой сотрудник «добавляет себя» к студенту.

    Раньше всегда была `lead`: МЗК-менеджер, нажавший «Добавить себя»,
    становился ментором по УП вместо МЗК.
    """
    return MentorRole.mzk if user.role == UserRole.mzk_manager else MentorRole.lead


@router.post("/student/{student_id}/self")
async def assign_self(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "mentor_assignments", Action.manage)
    role = self_assign_role(current_user)

    # Роль занята другим — молча вставать вторым нельзя: так у студентов и
    # появлялись два «ментора по УП» сразу, а следующая замена падала на них.
    occupied = await db.execute(
        select(MentorAssignment.id).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.mentor_id.is_not(None),
            MentorAssignment.mentor_id != current_user.id,
        ).limit(1)
    )
    if occupied.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="Роль уже занята — замените ответственного в «Команде ученика»",
        )

    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            (MentorAssignment.mentor_id == current_user.id) | (MentorAssignment.mentor_id.is_(None)),
        )
    )
    # Своя строка важнее плейсхолдера «требуется назначение».
    rows = sorted(result.scalars().all(), key=lambda a: a.mentor_id is None)
    ma = rows[0] if rows else None
    if ma:
        ma.mentor_id = current_user.id
        ma.is_active = True
    else:
        ma = MentorAssignment(
            student_id=student_id,
            mentor_id=current_user.id,
            role=role,
            is_active=True,
        )
        db.add(ma)
    if role == MentorRole.mzk:
        await _mirror_mzk_to_contract(db, student_id, current_user.id)
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
            # Без роли запрос находил две строки у того, кто ведёт студента
            # в двух ролях (МЗК и ментор по УП), и падал с 500.
            MentorAssignment.role == self_assign_role(current_user),
        )
    )
    ma = result.scalars().first()
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


async def _mirror_mzk_to_contract(db: AsyncSession, student_id: uuid.UUID, mentor_id: uuid.UUID) -> None:
    """Продублировать назначение МЗК в contracts.mzk_manager_id.

    Источник истины — MentorAssignment(role=mzk): именно его пишет назначение и
    читает доска распределения. Но `contracts.mzk_manager_id` до сих пор читают
    шесть мест, переехать которым — отдельная задача: workspace.py:74,
    tasks.py:97, payments.py, telegram_chats.py:186, task_urgency_notifier.py,
    payment_notifier.py. Без зеркала назначенный через доску МЗК не увидел бы
    своих студентов в задачах и уведомлениях.

    Направление ровно одно: назначение -> договор. Обратно не синхронизируем,
    иначе снова два равноправных источника и та же рассинхронизация, из-за
    которой фильтр «Ответственный -> МЗК» ничего не находил.

    Коммит — на вызывающем, как и во всём _assign_one.
    """
    from app.models.contract import Contract

    result = await db.execute(
        select(Contract)
        .where(Contract.student_id == student_id)
        .order_by(Contract.created_at.desc())
        .limit(1)
    )
    contract = result.scalar_one_or_none()
    # Договора может не быть (студент заведён до подписания) — тогда зеркалить
    # некуда, и это не ошибка: доска работает от назначения.
    if contract is not None:
        contract.mzk_manager_id = mentor_id


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
    if same is not None and same.is_active:
        return "already", same

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
    # Все, а не один: старые двойники в роли (два активных сразу) роняли
    # scalar_one_or_none() с MultipleResultsFound, и замена отвечала 500.
    # Замена снимает всех — после неё в роли снова один человек.
    previous_all = active_result.scalars().all()
    if previous_all and not replacement_reason.strip():
        return "needs_reason", None

    outcome = "created"
    for previous in previous_all:
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

    # Снятая строка на этого же специалиста включается обратно — но только
    # после того, как текущий в роли снят выше. Раньше включение шло первым и
    # мимо замены, и в роли оказывалось двое активных.
    if same is not None:
        same.is_active = True
        same.assignment_status = assignment_status
        if role == MentorRole.mzk:
            await _mirror_mzk_to_contract(db, student_id, mentor_id)
        return outcome, same

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
    if role == MentorRole.mzk:
        await _mirror_mzk_to_contract(db, student_id, mentor_id)
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


async def _clear_mzk_mirror(db: AsyncSession, student_id: uuid.UUID, mentor_id: uuid.UUID) -> None:
    """Пара к `_mirror_mzk_to_contract`: снятого МЗК убрать и из договора.

    Только если в договоре стоит именно он — чужое значение не трогаем.
    """
    from app.models.contract import Contract

    result = await db.execute(
        select(Contract)
        .where(Contract.student_id == student_id)
        .order_by(Contract.created_at.desc())
        .limit(1)
    )
    contract = result.scalar_one_or_none()
    if contract is not None and contract.mzk_manager_id == mentor_id:
        contract.mzk_manager_id = None


async def unassign_one(
    db: AsyncSession, *, ma: MentorAssignment, reason: str, actor_id: uuid.UUID
) -> None:
    """Снять ответственного без замены. Коммит — на вызывающем.

    Строку не удаляем, а выключаем: снятие должно оставить след в истории, и
    повторное назначение того же человека включит эту же строку обратно
    (см. `_assign_one`).
    """
    ma.is_active = False
    ma.assignment_status = "removed"
    db.add(MentorAssignmentHistory(
        student_id=ma.student_id,
        role=ma.role.value,
        previous_mentor_id=ma.mentor_id,
        replacement_mentor_id=None,
        reason=reason,
        changed_by=actor_id,
    ))
    if ma.role == MentorRole.mzk and ma.mentor_id is not None:
        await _clear_mzk_mirror(db, ma.student_id, ma.mentor_id)


@router.post("/{assignment_id}/unassign")
async def unassign_assignment(
    assignment_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Снять ответственного: из «Команды ученика» или броском в «Без
    ответственного» на доске. Раньше снять было нельзя вообще — назначение
    делалось один раз и навсегда."""
    require_access(current_user, "mentor_assignments", Action.manage)
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Укажите причину снятия")
    ma = await db.get(MentorAssignment, assignment_id)
    if ma is None:
        raise HTTPException(status_code=404, detail="Назначение не найдено")
    if not ma.is_active:
        raise HTTPException(status_code=409, detail="Ответственный уже снят")
    await unassign_one(db, ma=ma, reason=reason, actor_id=current_user.id)
    await db.commit()
    return {"ok": True}


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


# ------------------------------------------------------------------ доска
# Роли, для которых доска берёт колонки не из менторов. Совпадает с
# ROLE_USER_SOURCE на фронте (frontend/src/types/index.ts): МЗК назначают из
# mzk_manager, остальные роли — из менторов.
_BOARD_STAFF_ROLE: dict[MentorRole, UserRole] = {
    MentorRole.mzk: UserRole.mzk_manager,
}


def _board_student(student, pipeline_status: str | None, assignment=None) -> dict:
    return {
        "id": str(student.id),
        "full_name": student.full_name,
        "pipeline_status": pipeline_status,
        "assignment_id": str(assignment.id) if assignment is not None else None,
        "assignment_status": assignment.assignment_status if assignment is not None else None,
    }


def _build_board(
    *,
    role: MentorRole,
    assignment_rows: list,
    staff: list,
    students: list,
    pipeline_by_student: dict,
) -> dict:
    """Разложить назначения по колонкам-сотрудникам. Чистая функция.

    Вынесена из ручки по тому же принципу, что `_aggregate_mentor_workload`
    (workspace.py): ORM остаётся снаружи, а раскладка проверяется юнит-тестом
    без базы — фикстур с БД в проекте нет.

    `assignment_rows` — тройки (назначение, студент, сотрудник) уже отфильтрованные
    по роли и активности; `students` — все неархивные студенты (из них считается
    колонка «без ответственного»); `staff` — сотрудники, чьи колонки должны быть
    даже пустыми.
    """
    by_staff: dict = defaultdict(list)
    staff_by_id: dict = {}
    assigned_student_ids: set = set()
    for assignment, student, person in assignment_rows:
        staff_by_id[person.id] = person
        assigned_student_ids.add(student.id)
        by_staff[person.id].append(
            _board_student(student, pipeline_by_student.get(student.id), assignment)
        )

    for person in staff:
        staff_by_id.setdefault(person.id, person)

    # Пустая колонка сотрудника нужна намеренно: это и ответ на вопрос «кто
    # свободен», и место, куда перетащить карточку. Но админ, который никого не
    # ведёт, — лишняя пустая колонка на каждой доске: он назначаем наравне с
    # менторами (_load_assignable_mentor), а не ведёт студентов постоянно.
    columns = [
        {
            "staff_id": str(person.id),
            "name": person.name,
            "user_role": person.role.value,
            "students": by_staff.get(person.id, []),
        }
        for person in staff_by_id.values()
        if person.role != UserRole.admin or by_staff.get(person.id)
    ]
    # Порядок стабилен между перерисовками: иначе после каждого перетаскивания
    # колонки менялись бы местами прямо под курсором.
    columns.sort(key=lambda c: (c["name"] or "").lower())

    unassigned = [
        _board_student(student, pipeline_by_student.get(student.id))
        for student in students
        if student.id not in assigned_student_ids
    ]

    return {
        "role": role.value,
        "totals": {
            "students": len(students),
            "assigned": len(assigned_student_ids),
            "unassigned": len(unassigned),
        },
        "columns": columns,
        "unassigned": unassigned,
    }


@router.get("/board")
async def assignment_board(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    role: str = Query(..., description="Роль назначения, распределение которой показываем"),
):
    """Кто из сотрудников ведёт каких студентов — одной ролью за раз.

    Зачем
    -----
    Назначить ответственного было можно, а посмотреть картину распределения —
    негде: фильтр в общей базе отвечает про одного человека за раз, и чтобы
    понять, кому достался студент, приходилось перебирать сотрудников вручную.
    Отсюда и ощущение, что система «забывает» назначения.

    Почему ровно одна роль
    ----------------------
    У студента ответственных несколько (МЗК, ментор по УП, профориентолог...),
    а на доске «колонка = сотрудник» одна карточка не может лежать в двух
    колонках сразу. Роль обязательна: без неё студент попадал бы на доску
    столько раз, сколько у него ответственных, и счётчики врали бы.
    """
    require_access(current_user, "assignment_overview", Action.view)
    try:
        mentor_role = MentorRole(role)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Неизвестная роль назначения: {role}")

    from app.models.student import Student
    from app.models.contract import Contract

    # Статус для карточки — из самого свежего договора студента, как в
    # list_students. Отдельным запросом, чтобы не тащить джойн в остальные.
    pipeline_by_student: dict[uuid.UUID, str | None] = {}
    contracts_result = await db.execute(
        select(Contract.student_id, Contract.pipeline_status)
        .order_by(Contract.student_id, Contract.created_at.desc())
    )
    for student_id, status in contracts_result.all():
        pipeline_by_student.setdefault(student_id, status.value if status else None)

    # Плейсхолдеры «ответственный требуется» (mentor_id IS NULL) отсекает сам
    # join к users, но статус проверяем явно — заполненный плейсхолдер остаётся
    # в статусе required, пока его не тронут.
    assignments_result = await db.execute(
        select(MentorAssignment, Student, User)
        .join(Student, Student.id == MentorAssignment.student_id)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.role == mentor_role,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.assignment_status != "required",
            Student.is_archived == False,  # noqa: E712
        )
        .order_by(Student.full_name)
    )

    staff_role = _BOARD_STAFF_ROLE.get(mentor_role, UserRole.mentor)
    staff_query = select(User).where(
        User.role.in_([staff_role, UserRole.admin]),
        User.is_active == True,  # noqa: E712
    )
    # Колонки — те, кто на эту роль и заявлен (users.mentor_specialties).
    # Пока специализации не проставлены, фильтр дал бы доску без единой
    # колонки, поэтому он включается, только если размечен хоть кто-то.
    # Сотрудник с уже существующими назначениями колонку не теряет в любом
    # случае — её создаёт сам assignment_rows в _build_board.
    marked_exists = (
        await db.execute(
            select(User.id)
            .where(
                User.is_active == True,  # noqa: E712
                User.mentor_specialties.any(mentor_role.value),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if marked_exists is not None:
        staff_query = staff_query.where(
            User.mentor_specialties.any(mentor_role.value)
        )
    staff_result = await db.execute(staff_query)

    students_result = await db.execute(
        select(Student)
        .where(Student.is_archived == False)  # noqa: E712
        .order_by(Student.full_name)
    )

    return _build_board(
        role=mentor_role,
        assignment_rows=list(assignments_result.all()),
        staff=list(staff_result.scalars()),
        students=list(students_result.scalars()),
        pipeline_by_student=pipeline_by_student,
    )
