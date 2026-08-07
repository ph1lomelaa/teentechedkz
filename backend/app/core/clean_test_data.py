"""Удаление данных, оставленных автотестами, — чтобы экраны читались на демо.

E2E-прогоны создают пользователей вида `e2e.mentor.1786004861@test.kz` вместе
со студентами, роадмапами и задачами. На локальном стенде их накопились сотни:
раздел «Задачи менторов» показывал 171 строку, из которых по делу были четыре.

Признак тестовых аккаунтов — домен `@test.kz`; для студентов и задач, у которых
почты нет, признак — служебный префикс и unix-таймстамп в имени. Демо-данные
(`demo.*@teenteched.kz`, префикс «Демо») и первый админ под эти условия не
подпадают и остаются на месте.

    docker exec tte_backend python -m app.core.clean_test_data          # показать
    docker exec tte_backend python -m app.core.clean_test_data --apply  # удалить
"""
from __future__ import annotations

import asyncio
import sys

from sqlalchemy import delete, func, or_, select

from app.core.database import AsyncSessionLocal
from app.models.complaint import Complaint
from app.models.roadmap import Roadmap
from app.models.student import Student
from app.models.student_task import StudentTask
from app.models.user import User

TEST_EMAIL_DOMAIN = "%@test.kz"
# «E2E Студент 1786004937», «B1 Гейт 1786009573», «Probe 1786005161»
TEST_NAME_RE = r"(E2E|B4|B1|BS|Probe|Dbg|Гейт)"
# Unix-таймстамп в имени — верный признак сгенерированной сущности.
TIMESTAMP_RE = r"[0-9]{10}"
TEST_TASK_RE = r"[0-9]{10}"


def _student_is_test():
    return or_(Student.full_name.op("~")(TEST_NAME_RE), Student.full_name.op("~")(TIMESTAMP_RE))


def _task_is_test():
    return or_(
        StudentTask.task_text.op("~")(TEST_TASK_RE),
        StudentTask.task_text.like("Назначить специалиста%"),
    )


async def clean(apply: bool) -> None:
    async with AsyncSessionLocal() as db:
        test_student_ids = (await db.execute(select(Student.id).where(_student_is_test()))).scalars().all()

        counts = {
            "student_tasks": await db.scalar(select(func.count()).select_from(StudentTask).where(_task_is_test())),
            "complaints": await db.scalar(
                select(func.count()).select_from(Complaint).where(Complaint.subject.op("~")(TIMESTAMP_RE))
            ),
            "roadmaps": await db.scalar(
                select(func.count()).select_from(Roadmap).where(Roadmap.student_id.in_(test_student_ids))
            )
            if test_student_ids
            else 0,
            "students": len(test_student_ids),
            "users": await db.scalar(
                select(func.count()).select_from(User).where(User.email.like(TEST_EMAIL_DOMAIN))
            ),
        }

        for table, count in counts.items():
            print(f"  {table:<16} {count}")

        if not apply:
            print("\nНичего не удалено. Повторите с --apply, чтобы применить.")
            return

        await db.execute(delete(StudentTask).where(_task_is_test()))
        await db.execute(delete(Complaint).where(Complaint.subject.op("~")(TIMESTAMP_RE)))
        if test_student_ids:
            await db.execute(delete(Roadmap).where(Roadmap.student_id.in_(test_student_ids)))
            await db.execute(delete(Student).where(Student.id.in_(test_student_ids)))
        await db.execute(delete(User).where(User.email.like(TEST_EMAIL_DOMAIN)))
        await db.commit()
        print("\nУдалено.")


if __name__ == "__main__":
    asyncio.run(clean(apply="--apply" in sys.argv))
