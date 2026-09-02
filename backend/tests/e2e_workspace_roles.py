"""HTTP access-matrix smoke for admin, MZK, mentor and student roles.

Гоняется в CI против поднятого uvicorn (см. .github/workflows/deploy.yml).
Адрес берётся из argv, как у остальных e2e: раньше порт был вписан в код
числом 8000, а CI поднимает приложение на 8001 — из-за этого скрипт и не
запускался ни разу.

Скрипт сам создаёт всё, что ему нужно, включая администратора и «чужого»
студента: в CI база пустая после bootstrap_db, готовых записей там нет.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
import uuid

import httpx
from sqlalchemy import delete, select

# `import app` работает только если каталог backend/ есть в sys.path. CI
# запускает скрипт как `python tests/e2e_*.py` из backend/, и тогда Python
# кладёт в sys.path[0] сам каталог tests/, а не backend/ — модуль `app` не
# находится. PYTHONPATH в workflow указывает на корень репозитория (ради
# пакета `migration`), backend/ туда не входит.
#
# Тот же приём, что в e2e_auth_intake.py. Держим внутри скрипта, а не в
# окружении: скрипт должен запускаться одинаково и из CI, и руками.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.database import AsyncSessionLocal, engine
from app.core.security import create_access_token
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.student import DegreeLevel, Student
from app.models.telegram_pairing_code import TelegramPairingCode
from app.models.user import User, UserRole


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001") + "/api/v1"


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS {label}")


async def setup(marker: str) -> dict[str, str]:
    async with AsyncSessionLocal() as db:
        # В CI база пустая: ни админа, ни студентов. Чего нет — заводим сами и
        # убираем за собой; что нашлось — не трогаем.
        admin = await db.scalar(select(User).where(User.role == UserRole.admin).limit(1))
        created_admin = admin is None
        if admin is None:
            admin = User(
                name=f"Admin {marker}",
                email=f"admin-{marker}@example.test",
                hashed_password="!",
                role=UserRole.admin,
            )
            db.add(admin)
        mentor = User(name=f"Mentor {marker}", email=f"mentor-{marker}@example.test", hashed_password="!", role=UserRole.mentor)
        mzk = User(name=f"MZK {marker}", email=f"mzk-{marker}@example.test", hashed_password="!", role=UserRole.mzk_manager)
        portal_user = User(name=f"Student {marker}", email=f"student-{marker}@example.test", hashed_password="!", role=UserRole.student)
        db.add_all([mentor, mzk, portal_user])
        await db.flush()
        student = Student(
            full_name=f"Role matrix {marker}",
            phone=f"+7000{uuid.uuid4().int % 10_000_000:07d}",
            degree_level=DegreeLevel.undergraduate,
            intake_year=2027,
            user_id=portal_user.id,
        )
        db.add(student)
        await db.flush()
        db.add(MentorAssignment(
            student_id=student.id,
            mentor_id=mentor.id,
            role=MentorRole.lead,
            is_active=True,
        ))
        foreign_student = await db.scalar(
            select(Student).where(Student.id != student.id, Student.is_archived == False).limit(1)  # noqa: E712
        )
        created_foreign = foreign_student is None
        if foreign_student is None:
            foreign_student = Student(
                full_name=f"Foreign {marker}",
                phone=f"+7001{uuid.uuid4().int % 10_000_000:07d}",
                degree_level=DegreeLevel.undergraduate,
                intake_year=2027,
            )
            db.add(foreign_student)
            await db.flush()
        await db.commit()
        return {
            "created_admin": "1" if created_admin else "",
            "created_foreign": "1" if created_foreign else "",
            "admin_id": str(admin.id),
            "mentor_id": str(mentor.id),
            "mzk_id": str(mzk.id),
            "portal_user_id": str(portal_user.id),
            "student_id": str(student.id),
            "foreign_student_id": str(foreign_student.id),
        }


async def cleanup(ids: dict[str, str], marker: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(TelegramPairingCode).where(
            TelegramPairingCode.created_by == uuid.UUID(ids["mentor_id"])
        ))
        student = await db.get(Student, uuid.UUID(ids["student_id"]))
        if student:
            await db.delete(student)
        if ids["created_foreign"]:
            foreign = await db.get(Student, uuid.UUID(ids["foreign_student_id"]))
            if foreign:
                await db.delete(foreign)
        await db.flush()
        emails = [
            f"mentor-{marker}@example.test",
            f"mzk-{marker}@example.test",
            f"student-{marker}@example.test",
        ]
        if ids["created_admin"]:
            emails.append(f"admin-{marker}@example.test")
        await db.execute(delete(User).where(User.email.in_(emails)))
        await db.commit()


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def main() -> None:
    marker = uuid.uuid4().hex[:10]
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    ids = loop.run_until_complete(setup(marker))
    tokens = {
        role: create_access_token({"sub": ids[f"{key}_id"], "role": role})
        for role, key in {
            "admin": "admin",
            "mzk_manager": "mzk",
            "mentor": "mentor",
            "student": "portal_user",
        }.items()
    }

    try:
        with httpx.Client(base_url=BASE, timeout=30) as client:
            for role in ("admin", "mzk_manager", "mentor"):
                response = client.get("/workspace/dashboard", headers=auth(tokens[role]), params={"scope": "mine"})
                require(response.status_code == 200, f"{role} can open workspace")

            denied_workspace = client.get("/workspace/dashboard", headers=auth(tokens["student"]))
            require(denied_workspace.status_code == 403, "student cannot open staff workspace")

            mentor_students = client.get("/workspace/students", headers=auth(tokens["mentor"]), params={"scope": "mine"})
            mentor_ids = {row["student"]["id"] for row in mentor_students.json()["items"]}
            require(mentor_ids == {ids["student_id"]}, "mentor sees only assigned student")

            portal = client.get("/portal/profile", headers=auth(tokens["student"]))
            require(portal.status_code == 200 and portal.json()["student"]["id"] == ids["student_id"], "student sees own portal profile")
            require(client.get("/portal/profile", headers=auth(tokens["admin"])).status_code == 403, "staff cannot impersonate student portal")

            pairing = client.post(
                "/telegram-chats/pairing-code",
                headers=auth(tokens["mentor"]),
                json={"student_id": ids["student_id"]},
            )
            require(pairing.status_code == 200, "mentor can pair assigned student")
            foreign_pairing = client.post(
                "/telegram-chats/pairing-code",
                headers=auth(tokens["mentor"]),
                json={"student_id": ids["foreign_student_id"]},
            )
            # Скоуп ментора снят 02.09.2026 (решение владельца, см.
            # services/mentor_scope.py): чужой ученик для ментора больше не
            # «не найден». Проверяем именно это, а не отсутствие проверки:
            # 404 здесь снова означал бы, что ограничение вернулось молча.
            require(foreign_pairing.status_code == 200, "mentor can pair any student")
            student_pairing = client.post(
                "/telegram-chats/pairing-code",
                headers=auth(tokens["student"]),
                json={"student_id": ids["student_id"]},
            )
            require(student_pairing.status_code == 403, "student cannot create pairing code")
            require(client.get("/telegram-chats/", headers=auth(tokens["student"])).status_code == 403, "student cannot list staff Telegram chats")
            require(client.get("/workspace/documents", headers=auth(tokens["student"])).status_code == 403, "student cannot access workspace documents")
    finally:
        loop.run_until_complete(cleanup(ids, marker))
        loop.run_until_complete(engine.dispose())
        loop.close()


if __name__ == "__main__":
    main()
