from __future__ import annotations
import uuid
from collections import defaultdict
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.body import required_uuid
from app.models.mentor_assignment import MULTI_ROLES, MentorAssignment, MentorRole
from app.models.mentor_assignment_history import MentorAssignmentHistory
from app.models.user import User, UserRole
from app.services.agreements import has_pending_agreement_signature
from app.services.assignment_candidates import candidates_query
from app.services.mentor_scope import default_assignment_role
from app.services.student_countries import primary_country_by_student

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

    Правило одно на всю систему и живёт в mentor_scope: им же определяется роль,
    когда сотрудник появляется у студента через встречу или роадмап. Пока копий
    было две, «Взять в работу» и «завести встречу» давали одному человеку разные
    роли у одного студента.
    """
    return default_assignment_role(user)


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
    # В мультироли второй ответственный штатен, и запрет здесь не нужен.
    if role not in MULTI_ROLES:
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
        )
    )
    rows = result.scalars().all()
    # Строк может быть несколько: человек ведёт студента и как МЗК, и как ментор
    # по УП. Без выбора запрос падал с 500 (MultipleResultsFound), а по жёсткому
    # равенству роли — промахивался: роль «Взять в работу» выводится из
    # специализаций, а их админ меняет в настройках, и после правки сотрудник не
    # мог снять с себя студента, которого сам же и взял.
    #
    # Берём ту, в которой он встал бы сейчас; если её нет — любую активную.
    preferred = self_assign_role(current_user)
    ma = (
        next((row for row in rows if row.role == preferred), None)
        or next((row for row in rows if row.is_active), None)
        or (rows[0] if rows else None)
    )
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

    # В мультироли назначение второго человека — это добавление, а не замена:
    # ученик подаётся в несколько стран, и каждую ведёт свой ментор. Прежних
    # поэтому не ищем и не гасим, и причина не нужна — её спрашивают, когда
    # кого-то снимают с роли, а здесь никого не снимают. Замена конкретного
    # человека в мультироли идёт через PATCH /mentor-assignments/{id}.
    previous_all: list[MentorAssignment] = []
    if role not in MULTI_ROLES:
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
        previous_all = list(active_result.scalars().all())
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

    if previous_all:
        # Снятие прежних должно дойти до БД раньше, чем появится новый активный.
        # Без этого flush порядок определяет unit of work SQLAlchemy, а он внутри
        # одного маппера делает INSERT до UPDATE — то есть новая строка вставлялась
        # бы, пока прежняя ещё активна, и уникальный индекс на (student_id, role)
        # (миграция 093) отклонял бы штатную замену.
        await db.flush()

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
        select(MentorAssignment)
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.assignment_status == "required",
            MentorAssignment.mentor_id.is_(None),
        )
        .limit(1)
    )
    # `.first()`, а не `scalar_one_or_none()`: плейсхолдер на роль заводится один
    # (students.py), но уникальностью это не подкреплено, а в мультироли «два
    # плейсхолдера» перестало быть невозможным состоянием. Прежний вызов упал бы
    # на них MultipleResultsFound, то есть 500 вместо назначения.
    ma = required_result.scalars().first()
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
    """Роль назначения из тела запроса — обязательна и явная.

    Раньше пустое поле молча означало `lead`, и запрос, забывший роль, тихо
    делал человека «Ментором по УП». Роль ответственного — не то, что стоит
    угадывать по умолчанию: ошибку видно только в карточке студента и только
    тому, кого назначили не туда.
    """
    if not raw:
        raise HTTPException(status_code=422, detail="Укажите роль назначения")
    try:
        return MentorRole(raw)
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
    student_id = required_uuid(body, "student_id")
    country_scope = (body.get("country_scope") or "").strip() or None

    # Со второго ответственного в мультироли страна обязательна: без неё две
    # строки в карточке выглядят одинаково, и непонятно, кто какую страну ведёт.
    # Первого пускаем без неё — на старте страна часто ещё не выбрана, и
    # требовать её сразу значило бы блокировать обычное назначение.
    if role in MULTI_ROLES and not country_scope:
        taken = await db.execute(
            select(MentorAssignment.id).where(
                MentorAssignment.student_id == student_id,
                MentorAssignment.role == role,
                MentorAssignment.is_active == True,  # noqa: E712
                MentorAssignment.mentor_id.is_not(None),
                MentorAssignment.mentor_id != mentor_id,
            ).limit(1)
        )
        if taken.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=422,
                detail="Укажите страну — у ученика уже есть ментор по стране",
            )

    first_task_due_date = None
    if body.get("first_task_due_date"):
        try:
            first_task_due_date = date.fromisoformat(body["first_task_due_date"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный срок первой задачи")

    assignment_status = "awaiting_signature" if await has_pending_agreement_signature(db, mentor) else "active"
    outcome, ma = await _assign_one(
        db,
        student_id=student_id,
        mentor_id=mentor_id,
        role=role,
        replacement_reason=body.get("replacement_reason") or "",
        actor_id=current_user.id,
        assignment_status=assignment_status,
        country_scope=country_scope,
        functional_zone=body.get("functional_zone"),
        first_task_due_date=first_task_due_date,
        is_active=body.get("is_active", True),
    )
    if outcome == "needs_reason":
        raise HTTPException(status_code=422, detail="Для замены специалиста укажите причину")
    try:
        await db.commit()
    except IntegrityError:
        # Роль заняли, пока шёл этот запрос. `with_for_update` выше держит
        # существующие строки, но не пустую роль: два одновременных назначения на
        # свободную роль доходят до вставки оба, и второго отсекает уникальный
        # индекс (миграции 093/095). Для назначающего это не сбой сервера, а «вас
        # опередили», и повторять запрос молча нельзя — он бы затёр чужое
        # назначение без причины и записи в истории.
        #
        # В мультироли тот же индекс ловит другое: на эту страну ментор уже есть.
        # Текст обязан различать два случая, иначе «роль занял другой сотрудник»
        # при добавлении второй страны выглядит как ошибка системы.
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=(
                f"Для страны «{country_scope}» ментор уже назначен"
                if role in MULTI_ROLES and country_scope
                else "Роль только что занял другой сотрудник — обновите карточку"
            ),
        )
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
            # Правило «кого можно назначить» одно — _load_assignable_mentor.
            # Здесь оно было своим и строже: админ не проходил, хотя через
            # «Назначить» его назначить было можно, и та же замена из другого
            # окна работала.
            new_mentor = await _load_assignable_mentor(db, new_mentor_id)
            if not new_mentor.is_active:
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
# Кого доска показывает колонками — то же правило, что наполняет выпадашку
# «кого назначить»: services/assignment_candidates.py. Раньше здесь была своя
# карта ролей и свой фильтр, и доска с выпадашкой предлагали разных людей.


def _board_student(student, pipeline_status: str | None, assignment=None, country: str | None = None) -> dict:
    # Год, ступень и страна — не для показа на карточке, а для фильтров доски:
    # у неё нет пагинации и серверных фильтров, отбор идёт на клиенте, и нечем
    # было отсеять пять лет набора сразу.
    return {
        "id": str(student.id),
        "full_name": student.full_name,
        "pipeline_status": pipeline_status,
        "intake_year": student.intake_year,
        "degree_level": student.degree_level.value if student.degree_level else None,
        "country": country,
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
    country_by_student: dict | None = None,
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
    countries = country_by_student or {}
    by_staff: dict = defaultdict(list)
    staff_by_id: dict = {}
    assigned_student_ids: set = set()
    for assignment, student, person in assignment_rows:
        staff_by_id[person.id] = person
        # Множество, а не счётчик: в мультироли (ментор по стране) у ученика
        # несколько ответственных, и его карточка честно лежит в нескольких
        # колонках. `totals.assigned` обязан считать самого ученика один раз,
        # иначе «340 студентов» разойдётся с суммой по доске.
        assigned_student_ids.add(student.id)
        by_staff[person.id].append(
            _board_student(
                student, pipeline_by_student.get(student.id), assignment, countries.get(student.id)
            )
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
        _board_student(student, pipeline_by_student.get(student.id), None, countries.get(student.id))
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

    # Колонки — тот же пул, что в выпадашке «кого назначить»: специализация,
    # либо соответствующая должность, либо админ. Прежний фильтр был уже — он
    # требовал совпадения учётной роли И специализации, поэтому МЗК-менеджер,
    # заведённый как ментор, на доску МЗК не попадал, хотя назначить его было
    # можно. Сотрудник с уже существующими назначениями колонку не теряет в
    # любом случае — её создаёт сам assignment_rows в _build_board.
    staff_result = await db.execute(candidates_query(mentor_role))

    students_result = await db.execute(
        select(Student)
        .where(Student.is_archived == False)  # noqa: E712
        .order_by(Student.full_name)
    )
    students = list(students_result.scalars())

    # Страна для фильтра доски — тем же правилом, что в общей базе, иначе один
    # и тот же ученик попадал бы под фильтр «США» на одном экране и не попадал
    # на другом.
    country_by_student = await primary_country_by_student(db, [s.id for s in students])

    return _build_board(
        role=mentor_role,
        assignment_rows=list(assignments_result.all()),
        staff=list(staff_result.scalars()),
        students=students,
        pipeline_by_student=pipeline_by_student,
        country_by_student=country_by_student,
    )
