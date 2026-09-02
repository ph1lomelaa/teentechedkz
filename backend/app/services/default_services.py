"""Default service set for a student.

Услуги раньше засеивались только разовым импортом из Excel
(`migration.runner`), поэтому у студентов, созданных позже (Notion-синк,
интейк-формы, ручное добавление), раздел «Услуги» оставался пустым.
Этот хелпер создаёт стандартный набор услуг при появлении студента.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.service import Service, ServiceType, ServiceStatus

# Стандартный набор услуг, который заводится каждому студенту.
# included=False / not_started — менеджер потом отмечает включённые.
DEFAULT_SERVICE_TYPES: tuple[ServiceType, ...] = (
    ServiceType.proforientation,
    ServiceType.ielts_mock,
    ServiceType.ielts_prep,
    ServiceType.sat_prep,
    ServiceType.portfolio_improvement,
    ServiceType.english_general,
)


async def ensure_default_services(db: AsyncSession, student_id: uuid.UUID) -> int:
    """Создать недостающие стандартные услуги для студента.

    Идемпотентно: добавляет только те типы, которых у студента ещё нет,
    поэтому безопасно вызывать повторно и на существующих студентах.
    Коммит остаётся на вызывающей стороне. Возвращает число созданных строк.

    Почему в конце flush
    --------------------
    Сессия собрана с `autoflush=False` (core/database.py). Без явного сброса
    добавленные здесь строки живут только в памяти сессии: следующий SELECT по
    услугам их не видит, решает, что услуги нет, и заводит вторую такую же —
    а на коммите это падает на `uq_services_student_service_type`. Ровно так
    ломалось «Создать студентов из анкет»: `_create_student_from_intake`
    зовёт сначала эту функцию, а потом `_apply_intake_services`, который
    делает такой SELECT.

    Тот же аргумент касается и обещанной выше идемпотентности: без flush
    повторный вызов в рамках одной транзакции не увидел бы собственных строк.
    Flush — не коммит: транзакция вызывающей стороны остаётся открытой.
    """
    existing = await db.execute(
        select(Service.service_type).where(Service.student_id == student_id)
    )
    have = {row[0] for row in existing.all()}

    created = 0
    for svc_type in DEFAULT_SERVICE_TYPES:
        if svc_type in have:
            continue
        db.add(
            Service(
                student_id=student_id,
                service_type=svc_type,
                included=False,
                status=ServiceStatus.not_started,
            )
        )
        created += 1
    if created:
        await db.flush()
    return created
