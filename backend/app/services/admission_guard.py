"""Регламент admission: без доступов к порталу вуза оффер не подтверждается.

Повод — кейс с поддельным оффером: компания узнала о подделке, только когда
студент прилетел в страну обучения. Доступ к порталу позволяет проверить
оффер самим, поэтому отметить «оффер получен» или «зачислен» без него нельзя.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application, SubmissionStatus
from app.models.credential import UniversityCredential

# Статусы, которые утверждают результат поступления. Отказ и ранние этапы
# не блокируются: проверять в них нечего.
GUARDED_STATUSES = frozenset({SubmissionStatus.offer_received, SubmissionStatus.enrolled})

PORTAL_CREDENTIALS_REQUIRED = HTTPException(
    status_code=422,
    detail="Нельзя отметить оффер или зачисление без доступов к порталу вуза. "
           "Добавьте ссылку, логин и пароль в «Доступы к порталам».",
    headers={"X-Error-Code": "PORTAL_CREDENTIALS_REQUIRED"},
)


def needs_portal_check(old: SubmissionStatus | None, new: SubmissionStatus | None) -> bool:
    """Проверяем только вход в статус: заявки, которые уже стоят в оффере
    до появления правила, не должны ломаться при правке других полей."""
    return new in GUARDED_STATUSES and old not in GUARDED_STATUSES


async def has_portal_credentials(db: AsyncSession, app: Application) -> bool:
    """Доступ привязан к этой подаче или к тому же вузу этого студента."""
    match = UniversityCredential.application_id == app.id
    if app.id is None:
        match = None
    if app.university_id is not None:
        same_uni = (UniversityCredential.student_id == app.student_id) & (
            UniversityCredential.university_id == app.university_id
        )
        match = same_uni if match is None else or_(match, same_uni)
    if match is None:
        return False
    res = await db.execute(select(UniversityCredential.id).where(match).limit(1))
    return res.scalar_one_or_none() is not None


async def require_portal_credentials(
    db: AsyncSession, app: Application, old: SubmissionStatus | None, new: SubmissionStatus | None,
) -> None:
    if needs_portal_check(old, new) and not await has_portal_credentials(db, app):
        raise PORTAL_CREDENTIALS_REQUIRED
