"""Живой прогон: привязка Telegram-группы, участники, переназначение, сессии.

Данные заводит сам и убирает за собой — как `e2e_workspace_roles.py`. Раньше
скрипт логинился настоящим админом из `FIRST_ADMIN_*` и брал первых двух
студентов, каких найдёт. В CI база пустая: ни админа, ни студентов, — поэтому
шаг не добавлялся, а без шага скрипт не запускался вообще (плюс в коде был
вписан порт 8000, которого нет ни в CI, ни в compose).

Внешних сервисов не требует: к Telegram не ходит — `consume_pairing_code` это
та же продовая функция, вызываемая локально.
"""
from __future__ import annotations

import asyncio
import time
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
from app.models.status_history import StatusHistory
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole
from app.models.telegram_chat import TelegramChat, TelegramChatStatus, TelegramChatType
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage, TelegramMessageType
from app.models.telegram_pairing_code import TelegramPairingCode
from app.models.telegram_participant_identity import TelegramParticipantIdentity
from app.services.telegram_bot import consume_pairing_code


BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001") + "/api/v1"


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS {label}")


async def create_group(marker: str) -> uuid.UUID:
    async with AsyncSessionLocal() as db:
        chat = TelegramChat(
            chat_id=-(int(time.time() * 1_000_000)),
            chat_type=TelegramChatType.group,
            title=marker,
            privacy_mode_disabled=True,
            status=TelegramChatStatus.unbound,
        )
        db.add(chat)
        await db.commit()
        return chat.id


async def consume_and_seed(chat_id: uuid.UUID, code: str) -> tuple[bool, uuid.UUID]:
    async with AsyncSessionLocal() as db:
        chat = await db.get(TelegramChat, chat_id)
        student = await consume_pairing_code(db, code, chat)
        await db.commit()
        if not student:
            return False, uuid.UUID(int=0)
        session = await db.scalar(
            select(TelegramChatSession).where(
                TelegramChatSession.chat_id == chat_id,
                TelegramChatSession.status == TelegramSessionStatus.active,
            )
        )
        db.add_all([
            TelegramMessage(
                chat_id=chat_id,
                session_id=session.id,
                telegram_message_id=1,
                sender_tg_id=700000001,
                sender_name="Test Staff",
                message_type=TelegramMessageType.text,
                raw_text="Staff message",
                raw_payload={},
            ),
            TelegramMessage(
                chat_id=chat_id,
                session_id=session.id,
                telegram_message_id=2,
                sender_tg_id=700000002,
                sender_name="Test Student",
                message_type=TelegramMessageType.text,
                raw_text="Student message",
                raw_payload={},
            ),
        ])
        await db.commit()
        return True, session.id


async def code_is_rejected(chat_id: uuid.UUID, code: str) -> bool:
    async with AsyncSessionLocal() as db:
        chat = await db.get(TelegramChat, chat_id)
        return await consume_pairing_code(db, code, chat) is None


async def cleanup(chat_id: uuid.UUID, code: str) -> None:
    async with AsyncSessionLocal() as db:
        identity_ids = list((await db.scalars(
            select(TelegramParticipantIdentity.id).where(TelegramParticipantIdentity.chat_id == chat_id)
        )).all())
        if identity_ids:
            await db.execute(delete(StatusHistory).where(
                StatusHistory.entity_type == "telegram_participant_identity",
                StatusHistory.entity_id.in_(identity_ids),
            ))
        await db.execute(delete(TelegramPairingCode).where(TelegramPairingCode.code == code))
        chat = await db.get(TelegramChat, chat_id)
        if chat:
            await db.delete(chat)
        await db.commit()


async def setup_actors(marker: str) -> tuple[str, str, str, list[uuid.UUID], list[uuid.UUID]]:
    """Свой админ и два своих студента. Возвращает id и что убрать за собой.

    Своих, а не «первых попавшихся»: чужого студента скрипт переназначает и
    перепривязывает, то есть меняет живые данные. На локальной базе с реальными
    учениками это недопустимо, а в CI брать было бы просто нечего.
    """
    async with AsyncSessionLocal() as db:
        admin = User(
            name=f"Admin {marker}",
            email=f"tg-admin-{marker}@example.test",
            # Пароля нет: токен выписываем напрямую, как в e2e_workspace_roles.
            hashed_password="!",
            role=UserRole.admin,
        )
        db.add(admin)
        await db.flush()
        students = []
        for index in (1, 2):
            student = Student(
                full_name=f"Telegram e2e {marker} #{index}",
                phone=f"+7000{uuid.uuid4().int % 10_000_000:07d}",
                degree_level=DegreeLevel.undergraduate,
                intake_year=2027,
            )
            db.add(student)
            students.append(student)
        await db.flush()
        ids = (str(admin.id), str(students[0].id), str(students[1].id))
        created_students = [s.id for s in students]
        await db.commit()
    return (*ids, [admin.id], created_students)


async def cleanup_actors(user_ids: list[uuid.UUID], student_ids: list[uuid.UUID]) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Student).where(Student.id.in_(student_ids)))
        await db.execute(delete(User).where(User.id.in_(user_ids)))
        await db.commit()


def main() -> None:
    marker = f"workspace-telegram-e2e-{uuid.uuid4().hex[:8]}"
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    chat_id = loop.run_until_complete(create_group(marker))
    code = ""
    user_ids: list[uuid.UUID] = []
    student_ids: list[uuid.UUID] = []
    # try открывается сразу после создания группы, а не после логина: раньше
    # проверка входа стояла до него, и упавший прогон оставлял в базе чат
    # навсегда. Уборка обязана покрывать всё, что уже создано.
    try:
        admin_id, first_student, second_student, user_ids, student_ids = loop.run_until_complete(
            setup_actors(marker)
        )
        with httpx.Client(base_url=BASE, timeout=30) as client:
            client.headers["Authorization"] = (
                f"Bearer {create_access_token({'sub': admin_id, 'role': 'admin'})}"
            )
            require(
                client.get("/workspace/students", params={"scope": "all"}).status_code == 200,
                "admin token accepted",
            )

            pairing = client.post("/telegram-chats/pairing-code", json={"student_id": first_student})
            require(pairing.status_code == 200 and pairing.json().get("deep_link"), "pairing deep-link created")
            code = pairing.json()["code"]

            consumed, original_session_id = loop.run_until_complete(consume_and_seed(chat_id, code))
            require(consumed, "production pairing logic consumed code")
            require(loop.run_until_complete(code_is_rejected(chat_id, code)), "pairing code is one-time")

            participants = client.get(f"/telegram-chats/{chat_id}/participants")
            require(participants.status_code == 200 and len(participants.json()) == 2, "group participants discovered")
            identified = client.post(f"/telegram-chats/{chat_id}/participants/700000001/identify-self")
            require(identified.status_code == 200 and identified.json()["role"] == "admin", "staff selected own Telegram identity")

            reassigned = client.post(f"/telegram-chats/{chat_id}/reassign", json={"student_id": second_student})
            require(reassigned.status_code == 200 and reassigned.json()["student_id"] == second_student, "group chat reassigned")
            sessions = client.get(f"/telegram-chats/{chat_id}/sessions")
            session_rows = sessions.json()
            require(sessions.status_code == 200 and len(session_rows) == 2, "session history preserved")
            require(any(row["id"] == str(original_session_id) and row["status"] == "closed" for row in session_rows), "previous session closed")
            require(any(row["student_id"] == second_student and row["status"] == "active" for row in session_rows), "new session active")

            paused = client.post(f"/telegram-chats/{chat_id}/pause")
            resumed = client.post(f"/telegram-chats/{chat_id}/resume")
            require(paused.status_code == 200 and paused.json()["status"] == "paused", "chat paused")
            require(resumed.status_code == 200 and resumed.json()["status"] == "active", "chat resumed")

            unbound = client.post(f"/telegram-chats/{chat_id}/unbind")
            require(
                unbound.status_code == 200
                and unbound.json()["status"] == "unbound"
                and unbound.json()["student_id"] is None,
                "mistaken group binding can be detached",
            )
            attached_again = client.post(
                f"/telegram-chats/{chat_id}/attach",
                json={"student_id": second_student},
            )
            require(
                attached_again.status_code == 200
                and attached_again.json()["status"] == "active"
                and attached_again.json()["student_id"] == second_student,
                "detached group can be attached again",
            )
    finally:
        loop.run_until_complete(cleanup(chat_id, code))
        loop.run_until_complete(cleanup_actors(user_ids, student_ids))
        loop.run_until_complete(engine.dispose())
        loop.close()


if __name__ == "__main__":
    main()
