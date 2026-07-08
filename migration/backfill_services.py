"""Backfill the default service set for existing students.

Услуги исторически заводились только импортом из Excel, поэтому у студентов,
добавленных позже (Notion-синк, интейк, ручное создание), раздел «Услуги» пуст.
Скрипт заводит недостающие стандартные услуги всем существующим студентам.

Идемпотентно — можно запускать повторно.

Запуск (из контейнера backend):
    docker compose exec backend python -m migration.backfill_services
Только активные (по умолчанию) или все, включая архивных:
    docker compose exec backend python -m migration.backfill_services --all
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.student import Student
from app.services.default_services import ensure_default_services


async def run(include_archived: bool) -> None:
    async with AsyncSessionLocal() as db:
        query = select(Student.id)
        if not include_archived:
            query = query.where(Student.is_archived == False)  # noqa: E712
        result = await db.execute(query)
        student_ids = [row[0] for row in result.all()]

        total_created = 0
        touched = 0
        for sid in student_ids:
            created = await ensure_default_services(db, sid)
            if created:
                touched += 1
                total_created += created
        await db.commit()

    print(
        f"Готово: студентов проверено {len(student_ids)}, "
        f"дозаведено услуг {total_created} у {touched} студентов."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill default services")
    parser.add_argument(
        "--all",
        dest="include_archived",
        action="store_true",
        help="включая архивных студентов",
    )
    args = parser.parse_args()
    asyncio.run(run(args.include_archived))


if __name__ == "__main__":
    main()
