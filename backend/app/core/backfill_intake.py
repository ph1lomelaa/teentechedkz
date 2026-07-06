"""Разовый бэкафилл уже привязанных студентов: дозаполняет профиль и создаёт
заявки по странам из данных анкет (intake_submissions), которые уже лежат в
базе, но никогда не попали в карточку студента из-за старой логики /sync
(привязка анкеты не переносила поля — см. sync.py: _backfill_student_fields).

Ничего не тянет заново из Google Sheets — работает с уже сохранённым raw_data.

Запуск (по умолчанию — сухой прогон, ничего не меняет в базе):
    python -m app.core.backfill_intake

Применить изменения:
    python -m app.core.backfill_intake --apply
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models import IntakeSubmission, IntakeStatus, Student


async def run_backfill(apply: bool) -> None:
    from app.api.v1.endpoints.sync import (
        map_row,
        _backfill_student_fields,
        _apply_intake_countries,
    )

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(IntakeSubmission)
            .where(
                IntakeSubmission.status == IntakeStatus.linked,
                IntakeSubmission.student_id.isnot(None),
            )
            .order_by(IntakeSubmission.student_id, IntakeSubmission.submitted_at.asc().nullslast())
        )
        submissions = result.scalars().all()

        students_cache: dict = {}
        total_fields_changed = 0
        total_countries_added = 0
        details: list[str] = []

        for submission in submissions:
            student = students_cache.get(submission.student_id)
            if student is None:
                student = (
                    await db.execute(
                        select(Student).where(Student.id == submission.student_id)
                    )
                ).scalars().first()
                if not student:
                    continue
                students_cache[submission.student_id] = student

            mapped = map_row(
                list(submission.raw_data.keys()),
                list(submission.raw_data.values()),
                submission.source,
            )
            changed = _backfill_student_fields(student, mapped)
            added = await _apply_intake_countries(db, student, mapped)

            if changed or added:
                total_fields_changed += len(changed)
                total_countries_added += added
                details.append(
                    f"  {student.full_name} ({student.id}): "
                    f"поля={changed or '—'}, страны+{added}"
                )

        print(f"Проверено анкет: {len(submissions)}, студентов в кэше: {len(students_cache)}")
        print(f"Затронуто студентов: {len(details)}")
        print(f"Всего дозаполненных полей: {total_fields_changed}")
        print(f"Всего добавленных заявок (стран): {total_countries_added}")
        if details:
            print("\nПодробности:")
            for line in details:
                print(line)

        if apply:
            await db.commit()
            print("\nПрименено (изменения сохранены в базе).")
        else:
            await db.rollback()
            print("\nСухой прогон — изменения НЕ сохранены. Запустите с --apply, чтобы применить.")


if __name__ == "__main__":
    asyncio.run(run_backfill(apply="--apply" in sys.argv))
