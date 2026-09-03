"""Живой прогон выдачи доступа тому, кто зарегистрировался сам.

Ради чего этот скрипт
---------------------
До появления привязки существовал тупик, который не ловился ничем: студент
занимал email раньше, чем менеджер открывал его карточку, и `grant-access`
отвечал 409 — а других путей выдать кабинет не было вовсе. Тупик состоял из
трёх звеньев (занятый email, `students.user_id`, роль), и юнит-тестами такое
не ловится: каждое звено по отдельности вело себя правильно.

Сам `/public/join` сюда не входит: он требует настоящий id_token от Google,
подделать который против живого сервера нельзя. Его решающая часть — вердикт
матчинга — покрыта отдельно и без сети в `test_access_requests.py`.

Запуск (приложение уже поднято):

    python tests/e2e_access_requests.py http://127.0.0.1:8001
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote_plus

import httpx
from dotenv import dotenv_values
from sqlalchemy import delete, or_, select

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

env_values = dotenv_values(REPO_ROOT / ".env")
# Явно переданный DATABASE_URL — главнее всего. Раньше вне контейнера скрипт
# его игнорировал и всегда собирал адрес с 127.0.0.1:5432 из .env: прогнать
# e2e против другой базы (или когда порт 5432 занят системным Postgres) было
# невозможно, а ошибка выглядела как «роль tte не существует».
if os.environ.get("DATABASE_URL"):
    pass
elif Path("/.dockerenv").exists():
    os.environ.setdefault("DATABASE_URL", os.environ["DATABASE_URL"])
else:
    db_user = quote_plus(str(env_values.get("POSTGRES_USER") or "tte"))
    db_password = quote_plus(str(env_values.get("POSTGRES_PASSWORD") or "tte"))
    db_name = quote_plus(str(env_values.get("POSTGRES_DB") or "tte_db"))
    os.environ["DATABASE_URL"] = (
        f"postgresql+asyncpg://{db_user}:{db_password}@127.0.0.1:5432/{db_name}"
    )

from app.core.database import AsyncSessionLocal, engine  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.models.access_request import AccessRequest  # noqa: E402
from app.models.audit_log import AuditLog  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.student import Student  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402

RAW_BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001"
BASE_URL = RAW_BASE if RAW_BASE.rstrip("/").endswith("/api/v1") else f"{RAW_BASE.rstrip('/')}/api/v1"


@dataclass
class Created:
    marker: str
    student_ids: set[uuid.UUID] = field(default_factory=set)
    user_ids: set[uuid.UUID] = field(default_factory=set)


def require(condition: bool, label: str, response: httpx.Response | None = None) -> None:
    if not condition:
        detail = ""
        if response is not None:
            detail = f" status={response.status_code} body={response.text[:500]}"
        raise AssertionError(label + detail)
    print(f"PASS {label}")


def bearer(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


async def seed(created: Created) -> dict:
    """Админ, карточка без кабинета и «самозаписавшийся» аккаунт с заявкой.

    Аккаунт заводим напрямую в базе ровно в том виде, в каком его оставляет
    /join: неактивный, с ролью-заглушкой и строкой в очереди.
    """
    from migration.transformers.normalize import normalize_phone

    admin_email = f"{created.marker}-admin@example.test"
    admin_password = "AdminSmoke2026!"
    phone = "+7 707 000 11 22"

    async with AsyncSessionLocal() as db:
        admin = User(
            name=created.marker,
            email=admin_email,
            hashed_password=hash_password(admin_password),
            role=UserRole.admin,
            is_active=True,
        )
        student_user = User(
            name=f"{created.marker} Ученик",
            # example.com, а не example.test: EmailStr отвергает зарезервированные
            # TLD, и через grant-access такой адрес не проходит валидацию.
            email=f"{created.marker}-student@example.com",
            hashed_password="!google",
            role=UserRole.mentor,  # роль-заглушка, как её ставит /join
            phone=phone,
            is_active=False,
        )
        # Так аккаунт заводил старый вход через Google: роль-заглушка,
        # is_active=False и НИ ОДНОЙ строки в access_requests. Такой человек
        # ждал вечно — очередь читает только заявки, и его там не было.
        ghost = User(
            name=f"{created.marker} Призрак",
            email=f"{created.marker}-ghost@example.com",
            hashed_password="!google",
            role=UserRole.mentor,
            is_active=False,
        )
        db.add_all([admin, student_user, ghost])
        await db.flush()

        card = Student(
            full_name=f"{created.marker} Ученик",
            phone=phone,
            degree_level="undergraduate",
            intake_year=2027,
        )
        db.add(card)
        await db.flush()

        db.add(
            AccessRequest(
                user_id=student_user.id,
                requested_role="student",
                full_name=card.full_name,
                phone_raw=phone,
                phone_normalized=normalize_phone(phone),
                suggested_student_id=card.id,
                suggested_confidence=1.0,
                suggested_method="phone_exact",
                status="new",
            )
        )
        await db.commit()
        created.user_ids.update({admin.id, student_user.id, ghost.id})
        created.student_ids.add(card.id)
        result = {
            "admin_email": admin_email,
            "admin_password": admin_password,
            "student_user_id": str(student_user.id),
            "student_email": student_user.email,
            "ghost_email": ghost.email,
            "card_id": str(card.id),
        }
    await engine.dispose()
    return result


async def card_owner(student_id: str) -> uuid.UUID | None:
    async with AsyncSessionLocal() as db:
        owner = (
            await db.execute(select(Student.user_id).where(Student.id == uuid.UUID(student_id)))
        ).scalar_one_or_none()
    await engine.dispose()
    return owner


async def cleanup(created: Created) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Notification).where(Notification.body.ilike(f"%{created.marker}%")))
        if created.user_ids:
            await db.execute(
                delete(AccessRequest).where(AccessRequest.user_id.in_(created.user_ids))
            )
        for student_id in created.student_ids:
            student = await db.get(Student, student_id)
            if student:
                student.user_id = None
                await db.flush()
                await db.delete(student)
        await db.flush()
        if created.user_ids:
            await db.execute(
                delete(AuditLog).where(
                    or_(
                        AuditLog.actor_user_id.in_(created.user_ids),
                        AuditLog.target_user_id.in_(created.user_ids),
                    )
                )
            )
            for user_id in created.user_ids:
                user = await db.get(User, user_id)
                if user:
                    await db.delete(user)
        await db.commit()
    await engine.dispose()


def main() -> None:
    created = Created(marker=f"e2e-access-{uuid.uuid4().hex[:8]}")
    seeded = asyncio.run(seed(created))

    admin = httpx.Client(base_url=BASE_URL, timeout=30)
    waiting = httpx.Client(base_url=BASE_URL, timeout=30)
    try:
        login = admin.post(
            "/auth/login",
            json={"email": seeded["admin_email"], "password": seeded["admin_password"]},
        )
        require(login.status_code == 200, "админ входит", login)
        auth = bearer(login.json())

        # --- очередь видна и содержит нашу заявку с подсказкой ---
        queue = admin.get("/access-requests", headers=auth)
        require(queue.status_code == 200, "очередь заявок открывается", queue)
        mine = next(
            (i for i in queue.json()["items"] if i["user"]["email"] == seeded["student_email"]),
            None,
        )
        require(mine is not None, "заявка попала в очередь")
        require(
            mine["suggested_student"] is not None
            and mine["suggested_student"]["id"] == seeded["card_id"],
            "в заявке видна подсказанная карточка",
        )
        require(mine["suggested_student"]["is_free"], "карточка помечена свободной")

        # --- аккаунт без заявки всё равно виден ---
        # Регрессия, из-за которой «заявки учеников просто не показывались»:
        # аккаунт, заведённый мимо /join, не имел строки в access_requests и в
        # очередь не попадал ни при каких фильтрах. Разовая миграция вычистила
        # накопленное, но не защищала от новых — теперь очередь достраивает их
        # при открытии.
        ghost_row = next(
            (i for i in queue.json()["items"] if i["user"]["email"] == seeded["ghost_email"]),
            None,
        )
        require(ghost_row is not None, "аккаунт без заявки подтянут в очередь")
        require(
            ghost_row["status"] == "new",
            "подтянутая заявка ждёт решения, а не считается обработанной",
        )

        # --- ловушка: роль ученика без карточки не выдаётся ---
        broken = admin.patch(
            f"/users/{seeded['student_user_id']}",
            json={"role": "student"},
            headers=auth,
        )
        require(broken.status_code == 409, "роль ученика без карточки отклонена", broken)

        # --- тупик: занятый email отдаёт машиночитаемый отказ ---
        conflict = admin.post(
            f"/students/{seeded['card_id']}/grant-access",
            json={"email": seeded["student_email"]},
            headers=auth,
        )
        require(conflict.status_code == 409, "занятый email отклонён", conflict)
        require(
            conflict.headers.get("X-Error-Code") == "USER_EXISTS",
            "отказ опознаётся по заголовку, а не по тексту",
            conflict,
        )
        require(
            conflict.json()["detail"]["user"]["id"] == seeded["student_user_id"],
            "в отказе приехал сам найденный аккаунт",
        )

        # --- и тупик размыкается привязкой ---
        linked = admin.post(
            f"/students/{seeded['card_id']}/link-user",
            json={"user_id": seeded["student_user_id"]},
            headers=auth,
        )
        require(linked.status_code == 201, "аккаунт привязан к карточке", linked)
        require(linked.json()["has_access"] is True, "карточка отдаёт статус «доступ есть»")
        require(
            str(asyncio.run(card_owner(seeded["card_id"]))) == seeded["student_user_id"],
            "students.user_id проставлен",
        )

        # --- человек теперь входит и видит кабинет ---
        me = waiting.get(
            "/auth/me",
            headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        )
        require(me.status_code == 200, "сессия админа жива после привязки", me)

        # --- заявка закрыта тем же действием, в очереди её больше нет ---
        queue_after = admin.get("/access-requests", headers=auth)
        require(
            all(i["user"]["email"] != seeded["student_email"] for i in queue_after.json()["items"]),
            "одобренная заявка ушла из очереди",
        )

        # --- повторная привязка не проходит ---
        again = admin.post(
            f"/students/{seeded['card_id']}/link-user",
            json={"user_id": seeded["student_user_id"]},
            headers=auth,
        )
        require(again.status_code == 409, "повторная привязка отклонена", again)

        print("ACCESS REQUESTS E2E PASSED")
    finally:
        admin.close()
        waiting.close()
        asyncio.run(cleanup(created))


if __name__ == "__main__":
    main()
