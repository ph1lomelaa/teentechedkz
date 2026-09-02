from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.mentor_assignment import MentorAssignment, MentorRole
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
        .order_by(MentorAssignment.assigned_at.desc())
        .limit(1)
    )
    return any_active.scalar_one_or_none()


async def ensure_lead_assignment(db: AsyncSession, student_id: uuid.UUID, mentor_id: uuid.UUID) -> None:
    """Ensure a mentor used by portal workflows is also visible in mentor scope.

    This keeps roadmap.mentor_id / meeting.mentor_id / chat contacts aligned
    with mentor_assignments, which is the access-control source for mentors.
    """
    existing = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.mentor_id == mentor_id,
            MentorAssignment.role == MentorRole.lead,
        )
    )
    assignment = existing.scalar_one_or_none()
    if assignment:
        assignment.is_active = True
        return

    db.add(
        MentorAssignment(
            student_id=student_id,
            mentor_id=mentor_id,
            role=MentorRole.lead,
            is_active=True,
        )
    )
