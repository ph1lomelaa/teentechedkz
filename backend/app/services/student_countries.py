"""Основная страна ученика — одним правилом на все экраны.

Страна не хранится у самого ученика: она живёт в заявках (`Application`), и
основной считается та, у которой стоит `is_primary`, а если такой нет —
первая по порядку. Правило простое, но его читают и общая база, и доска
распределения, и разъехавшись они показали бы разную страну для одного
человека — в фильтре по стране это выглядит как потерянные ученики.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.application import Application


async def primary_country_by_student(
    db: AsyncSession, student_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """`{student_id: страна}` одним запросом вместо N+1 по ученикам."""
    if not student_ids:
        return {}

    result = await db.execute(
        select(Application.student_id, Application.country)
        .where(Application.student_id.in_(list(student_ids)))
        # `is_primary` вперёд, дальше стабильный порядок по id: без второго
        # ключа две заявки без признака основной меняли бы страну ученика
        # местами от запроса к запросу.
        .order_by(Application.is_primary.desc(), Application.id)
    )

    countries: dict[uuid.UUID, str] = {}
    for student_id, country in result.all():
        if country and student_id not in countries:
            countries[student_id] = country
    return countries
