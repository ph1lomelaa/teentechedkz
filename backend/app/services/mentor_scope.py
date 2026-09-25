from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mentor_assignment import ASSIGNABLE_ROLES, MentorAssignment, MentorRole
from app.models.user import User, UserRole


async def mentor_assigned_student_ids(db: AsyncSession, user: User) -> set[uuid.UUID] | None:
    """Каких учеников этот сотрудник имеет право трогать.

    `None` — «ограничивать не надо». Множество (возможно пустое) — вызывающий
    обязан сузиться до него.

    Сейчас всегда `None`: решение владельца от 02.09.2026 — сотрудник видит
    карточку любого ученика, а не только своих. До этого ментор получал 404 на
    чужой карточке, хотя список всех учеников в общей базе ему и так был
    открыт: ограничение висело на карточке, но не на списке, и выглядело
    случайным.

    Что это открывает — важно понимать, потому что через этот же гейт идут
    18 мест: родители с ИИН, конфиденциальные заметки, документы, переписка.
    Решение осознанное: команда небольшая, и подмена доступа согласованием
    мешала работе больше, чем защищала.

    Функция намеренно оставлена, а не вырезана из 18 вызовов: если правило
    вернётся (например, вырастет команда или появится требование по ПДн),
    менять придётся одно место, а не всю обвязку заново. `db` и `user`
    остаются в сигнатуре по той же причине.
    """
    del db, user  # см. докстринг: скоуп выключен, но плечо для возврата цело
    return None


async def require_student_access(db: AsyncSession, student_id: uuid.UUID, user: User) -> None:
    """Пропускает всех, пока скоуп выключен (см. mentor_assigned_student_ids).

    Оставлена по всем 18 вызовам специально: это точка, где ограничение
    включается обратно одним изменением.
    """
    allowed_ids = await mentor_assigned_student_ids(db, user)
    if allowed_ids is None:
        return
    if student_id not in allowed_ids:
        raise HTTPException(status_code=404, detail="Студент не найден")


async def primary_mentor_id(db: AsyncSession, student_id: uuid.UUID) -> uuid.UUID | None:
    """Return the best default mentor for student-facing workflows.

    The active lead mentor is the owner of the student journey. If there is no
    active lead assignment yet, fall back to any active mentor assignment so
    meetings/roadmaps/chat still attach to a real staff user when possible.
    """
    lead = await db.execute(
        select(MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == MentorRole.lead,
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(MentorAssignment.assigned_at.desc())
        .limit(1)
    )
    mentor_id = lead.scalar_one_or_none()
    if mentor_id:
        return mentor_id

    any_active = await db.execute(
        select(MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
        # `id` вторым ключом — не косметика: у ученика с несколькими менторами по
        # стране (их назначают подряд) `assigned_at` совпадает до долей секунды,
        # и по одному лишь времени Postgres волен вернуть любого. «Главный
        # ментор» карточки, адресат уведомления о платеже и контакт чата тогда
        # менялись бы между запросами без единого действия человека.
        .order_by(MentorAssignment.assigned_at.desc(), MentorAssignment.id.desc())
        .limit(1)
    )
    return any_active.scalar_one_or_none()


def default_assignment_role(user: User) -> MentorRole:
    """Роль, в которой сотрудник по умолчанию встаёт к студенту.

    Раньше роль выводилась из одного только `user.role`, и всё, что не
    `mzk_manager`, становилось `lead`. Из-за этого профориентолог, заводивший
    студенту встречу, оказывался в карточке «Ментором по УП» — не той ролью, в
    которой он работает, и не той, за которую отвечает по регламенту.

    Теперь спрашиваем сначала `mentor_specialties` — поле, где и написано, кем
    человек работает. Если специализация ровно одна, это и есть ответ. Если их
    несколько, угадывать нельзя: остаётся `lead`, а правильную роль выберут
    руками через «Команду ученика».

    Это подпись, а не право доступа: `mentor_specialties` по-прежнему не
    участвует в require_access (см. models/user.py).
    """
    if user.role == UserRole.mzk_manager:
        return MentorRole.mzk

    assignable = {role.value for role in ASSIGNABLE_ROLES}
    declared = [s for s in (user.mentor_specialties or []) if s in assignable]
    if len(declared) == 1:
        return MentorRole(declared[0])

    return MentorRole.lead


async def ensure_assignment_exists(db: AsyncSession, student_id: uuid.UUID, mentor_id: uuid.UUID) -> None:
    """Сотрудник, которого портальные сценарии уже используют, должен быть виден
    в назначениях — но ровно один раз и в своей роли.

    Держит roadmap.mentor_id / meeting.mentor_id / контакты чата согласованными с
    mentor_assignments.

    Два правила, которых тут раньше не было:

    1. Если у сотрудника уже есть ЛЮБОЕ активное назначение на этого студента —
       не трогаем ничего. Прежняя версия смотрела только на роль `lead` и потому
       заводила профориентологу вторую строку «Ментор по УП» при первой же
       встрече: в «Команде ученика» человек начинал числиться дважды и в чужой
       роли, а в истории замен об этом не было ни слова.
    2. Новую строку заводим в роли из `default_assignment_role`, а не всегда в
       `lead`.

    Это по-прежнему тихая запись в обход `_assign_one` (без причины и истории) —
    осознанно: тут не замена ответственного, а фиксация того, что и так
    произошло. Замена чужого назначения этим путём невозможна: занятую роль
    закрывает пункт 1 и уникальные индексы на назначениях (см. модель).
    """
    existing = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.mentor_id == mentor_id,
        )
    )
    rows = existing.scalars().all()
    if any(row.is_active for row in rows):
        return

    mentor = (await db.execute(select(User).where(User.id == mentor_id))).scalar_one_or_none()
    if mentor is None:
        return
    role = default_assignment_role(mentor)

    # Снятое назначение включаем обратно, а не плодим второе — ровно так же
    # ведут себя assign_self и _assign_one.
    for row in rows:
        if row.role == role:
            row.is_active = True
            await _mirror_mzk(db, student_id, mentor_id, role)
            return

    # Роль занята другим — молча вставать вторым нельзя, это работа «Команды
    # ученика» с причиной и историей. Сотрудник останется mentor_id у встречи,
    # но ответственным не станет.
    #
    # Для мультироли проверка тоже остаётся, хотя второй ответственный там
    # штатен: страну этот путь не знает, а без неё уникальный индекс отклонит
    # вторую строку. Первого ментора по стране он заведёт как раньше, второго
    # добавят руками в «Команде ученика», указав страну.
    occupied = await db.execute(
        select(MentorAssignment.id).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.mentor_id.is_not(None),
        ).limit(1)
    )
    if occupied.scalar_one_or_none() is not None:
        return

    # Плейсхолдер «требуется назначение» заполняем, а не дублируем.
    placeholder = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == role,
            MentorAssignment.mentor_id.is_(None),
        ).limit(1)
    )
    slot = placeholder.scalar_one_or_none()
    if slot is not None:
        slot.mentor_id = mentor_id
        slot.is_active = True
        slot.assignment_status = "active"
        await _mirror_mzk(db, student_id, mentor_id, role)
        return

    db.add(
        MentorAssignment(
            student_id=student_id,
            mentor_id=mentor_id,
            role=role,
            is_active=True,
        )
    )
    await _mirror_mzk(db, student_id, mentor_id, role)


async def _mirror_mzk(
    db: AsyncSession, student_id: uuid.UUID, mentor_id: uuid.UUID, role: MentorRole
) -> None:
    """Продублировать назначение МЗК в договор, если роль оказалась `mzk`.

    Шесть мест до сих пор читают `contracts.mzk_manager_id` (задачи, платежи,
    уведомления), поэтому МЗК, попавший в назначения этим путём, без зеркала не
    увидел бы своих студентов. Импорт локальный: `mentor_assignments` — это
    endpoints, и на уровне модуля он бы замкнул цикл через этот же сервис.
    """
    if role != MentorRole.mzk:
        return
    from app.api.v1.endpoints.mentor_assignments import _mirror_mzk_to_contract

    await _mirror_mzk_to_contract(db, student_id, mentor_id)
