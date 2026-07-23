"""Local integration smoke for the group->supergroup chat_id migration fix.

Reproduces the exact failure this guards against: a bound, active Telegram
group gets a new numeric chat_id (Telegram's supergroup migration), and every
real message sent afterward must keep landing against the *same* bound chat
row instead of silently spawning an orphaned `unbound` one.

Runs directly against the models/dispatcher (no HTTP, no real Telegram
network calls) so it can be exercised with `DATABASE_URL` pointed at the
docker-compose postgres exposed on localhost:5432.
"""
from __future__ import annotations

import asyncio
import time
import uuid

from sqlalchemy import select

from app.core.database import AsyncSessionLocal, engine
from app.models.student import Student
from app.models.telegram_chat import TelegramChat, TelegramChatStatus, TelegramChatType
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage
from app.services.telegram_bot import get_bot, get_dispatcher


def require(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)
    print(f"PASS {label}")


def _update_payload(update_id: int, message: dict) -> dict:
    return {"update_id": update_id, "message": message}


def _base_message(message_id: int, chat_id: int, chat_type: str) -> dict:
    now = int(time.time())
    return {
        "message_id": message_id,
        "date": now,
        "chat": {"id": chat_id, "type": chat_type, "title": "E2E migration test group"},
    }


async def setup_bound_chat(old_chat_id: int) -> tuple[uuid.UUID, uuid.UUID]:
    async with AsyncSessionLocal() as db:
        student = await db.scalar(select(Student).limit(1))
        require(student is not None, "a student exists to bind the chat to")

        chat = TelegramChat(
            chat_id=old_chat_id,
            chat_type=TelegramChatType.group,
            title="E2E migration test group",
            status=TelegramChatStatus.active,
        )
        db.add(chat)
        await db.flush()
        session = TelegramChatSession(chat_id=chat.id, student_id=student.id, status=TelegramSessionStatus.active)
        db.add(session)
        await db.commit()
        return chat.id, student.id


async def feed(update: dict, update_id: int) -> None:
    bot = get_bot()
    dp = get_dispatcher()
    from aiogram.types import Update

    parsed = Update.model_validate(update)
    await dp.feed_update(bot=bot, update=parsed, update_id=update_id)


async def cleanup(internal_chat_id: uuid.UUID, new_chat_id: int) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            select(TelegramMessage).where(TelegramMessage.chat_id == internal_chat_id)
        )
        chat = await db.get(TelegramChat, internal_chat_id)
        if chat:
            await db.delete(chat)
        stray = await db.scalar(select(TelegramChat).where(TelegramChat.chat_id == new_chat_id))
        if stray:
            await db.delete(stray)
        await db.commit()


def main() -> None:
    old_chat_id = -(int(time.time() * 1_000_000))
    new_chat_id = int(f"-100{abs(old_chat_id)}")  # Telegram's real supergroup id shape
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    internal_chat_id = None
    try:
        internal_chat_id, student_id = loop.run_until_complete(setup_bound_chat(old_chat_id))

        # 1) The old-chat system notice (migrate_to_chat_id) must not blow up
        #    or leave a blank message row.
        migrate_notice = _base_message(1, old_chat_id, "group")
        migrate_notice["migrate_to_chat_id"] = new_chat_id
        loop.run_until_complete(feed(_update_payload(9001, migrate_notice), 9001))

        # 2) The new-chat migration message (migrate_from_chat_id) is what
        #    should trigger the rebind.
        migrate_landing = _base_message(2, new_chat_id, "supergroup")
        migrate_landing["migrate_from_chat_id"] = old_chat_id
        loop.run_until_complete(feed(_update_payload(9002, migrate_landing), 9002))

        async def check_rebound() -> TelegramChat | None:
            async with AsyncSessionLocal() as db:
                return await db.get(TelegramChat, internal_chat_id)

        chat_after = loop.run_until_complete(check_rebound())
        require(chat_after is not None, "bound chat row still exists after migration")
        require(chat_after.chat_id == new_chat_id, "bound chat row's chat_id was updated to the new supergroup id")
        require(chat_after.chat_type == TelegramChatType.supergroup, "chat_type flipped to supergroup")

        async def no_orphan_created() -> bool:
            async with AsyncSessionLocal() as db:
                # Any *other* row claiming the new chat_id would mean we
                # created an orphaned unbound chat instead of rebinding.
                rows = (await db.execute(
                    select(TelegramChat).where(TelegramChat.chat_id == new_chat_id)
                )).scalars().all()
                return len(rows) == 1 and rows[0].id == internal_chat_id

        require(loop.run_until_complete(no_orphan_created()), "no orphaned unbound chat row was created for the new chat_id")

        # 3) A real message sent after the migration, under the new chat_id,
        #    must be ingested against the *same* (now rebound) chat — this is
        #    the actual bug: pre-fix, this message would vanish silently.
        real_message = _base_message(3, new_chat_id, "supergroup")
        real_message["text"] = "student reply after migration"
        real_message["from"] = {"id": 555000111, "is_bot": False, "first_name": "Student"}
        loop.run_until_complete(feed(_update_payload(9003, real_message), 9003))

        async def message_landed() -> bool:
            async with AsyncSessionLocal() as db:
                row = await db.scalar(
                    select(TelegramMessage).where(
                        TelegramMessage.chat_id == internal_chat_id,
                        TelegramMessage.raw_text == "student reply after migration",
                    )
                )
                return row is not None

        require(loop.run_until_complete(message_landed()), "post-migration message was ingested against the rebound chat, not dropped")
    finally:
        if internal_chat_id is not None:
            loop.run_until_complete(cleanup(internal_chat_id, new_chat_id))
        loop.run_until_complete(engine.dispose())
        loop.close()


if __name__ == "__main__":
    main()
