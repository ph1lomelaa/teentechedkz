"""Telegram bot service — aiogram 3.x webhook mode.

One bot handles two roles:
- Mentor commands (/status, /new, /tasks) — restricted to private chats.
- Client group ingestion — my_chat_member (bot added to a group) and
  plain messages get stored against telegram_chats/telegram_messages so a
  manager can bind the chat to a student from the CRM UI.
"""
from __future__ import annotations
import logging
from datetime import date, datetime, timezone

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import ChatMemberUpdated, Message, Update

from app.core.config import settings

logger = logging.getLogger(__name__)

bot: Bot | None = None
dp: Dispatcher | None = None
router = Router()


def get_bot() -> Bot:
    global bot
    if bot is None:
        if not settings.TELEGRAM_BOT_TOKEN:
            raise RuntimeError("TELEGRAM_BOT_TOKEN not configured")
        bot = Bot(token=settings.TELEGRAM_BOT_TOKEN)
    return bot


def get_dispatcher() -> Dispatcher:
    global dp
    if dp is None:
        dp = Dispatcher()
        dp.include_router(router)
    return dp


async def _upsert_chat(db, tg_chat) -> "TelegramChat":
    from sqlalchemy import select
    from app.models.telegram_chat import TelegramChat, TelegramChatType

    chat_type_map = {
        "private": TelegramChatType.private,
        "group": TelegramChatType.group,
        "supergroup": TelegramChatType.supergroup,
    }
    result = await db.execute(select(TelegramChat).where(TelegramChat.chat_id == tg_chat.id))
    chat = result.scalar_one_or_none()
    if chat is None:
        chat = TelegramChat(
            chat_id=tg_chat.id,
            chat_type=chat_type_map.get(tg_chat.type, TelegramChatType.private),
            title=tg_chat.title or getattr(tg_chat, "full_name", None),
        )
        db.add(chat)
        await db.flush()
    return chat


@router.my_chat_member()
async def on_my_chat_member(event: ChatMemberUpdated):
    """Fires whenever the bot's own membership status changes in a chat —
    added to a group, removed, promoted to admin — regardless of privacy
    mode or admin rights. This is how we detect "someone added the bot"."""
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, event.chat)
        await db.commit()
        logger.info(f"Telegram chat registered: chat_id={event.chat.id} status={chat.status}")


@router.message(CommandStart(deep_link=True))
async def on_start_with_payload(message: Message, command):
    """Deep-link pairing: t.me/<bot>?start=<code> — binds this chat to the
    student the code was generated for, without the manager having to know
    the chat_id."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.telegram_pairing_code import TelegramPairingCode
    from app.models.telegram_chat import TelegramChatStatus
    from app.models.telegram_chat_session import TelegramChatSession
    from app.models.student import Student

    code = (command.args or "").strip()

    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, message.chat)

        result = await db.execute(select(TelegramPairingCode).where(TelegramPairingCode.code == code))
        pairing = result.scalar_one_or_none()

        now = datetime.now(timezone.utc)
        if not pairing or pairing.used_at is not None or pairing.expires_at < now:
            await db.commit()
            await message.answer(
                "Ссылка недействительна или уже использована. Обратитесь к менеджеру за новой."
            )
            return

        student = await db.get(Student, pairing.student_id)
        pairing.used_at = now
        chat.status = TelegramChatStatus.active
        db.add(TelegramChatSession(chat_id=chat.id, student_id=pairing.student_id))
        await db.commit()

        await message.answer(
            f"Готово! Этот чат подключён к профилю: {student.full_name}.\n"
            "Можете присылать сообщения, документы, фото и голосовые — "
            "всё попадёт в карточку студента после проверки менеджером."
        )


@router.message(Command("start"), F.chat.type == "private")
async def cmd_start(message: Message):
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.user import User

    async with AsyncSessionLocal() as db:
        user_result = await db.execute(
            select(User).where(User.telegram_id == str(message.from_user.id))
        )
        is_mentor = user_result.scalar_one_or_none() is not None

    if is_mentor:
        await message.answer(
            "👋 Добро пожаловать в TeenTechEd CRM!\n\n"
            "Доступные команды:\n"
            "/status <телефон> — статус студента\n"
            "/new — создать новую заявку\n"
            "/tasks — мои открытые задачи\n"
        )
        return

    await message.answer(
        "Здравствуйте! Этот чат пока не привязан к профилю студента.\n"
        "Попросите вашего менеджера прислать вам ссылку для подключения."
    )


@router.message(Command("status"), F.chat.type == "private")
async def cmd_status(message: Message):
    from app.core.database import AsyncSessionLocal
    from app.models.student import Student
    from app.models.contract import Contract
    from sqlalchemy import select

    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer("Укажите телефон: /status +77001234567")
        return

    phone = args[1].strip()

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Student).where(Student.phone.contains(phone.replace("+", "").replace("-", "").replace(" ", "")))
        )
        student = result.scalar_one_or_none()

        if not student:
            await message.answer(f"Студент с номером {phone} не найден.")
            return

        contract_result = await db.execute(
            select(Contract).where(Contract.student_id == student.id).order_by(Contract.created_at.desc()).limit(1)
        )
        contract = contract_result.scalar_one_or_none()

        status_text = "—"
        days_text = "—"
        if contract:
            status_text = contract.pipeline_status.value if contract.pipeline_status else "—"
            if contract.signed_date:
                days_text = str((date.today() - contract.signed_date).days)

    text = (
        f"👤 *{student.full_name}*\n"
        f"📞 {student.phone}\n"
        f"📅 Год поступления: {student.intake_year}\n"
        f"📊 Статус: {status_text}\n"
        f"⏱ Дней в работе: {days_text}"
    )
    await message.answer(text, parse_mode="Markdown")


@router.message(Command("new"), F.chat.type == "private")
async def cmd_new(message: Message):
    url = f"{settings.FRONTEND_URL}/students/new"
    await message.answer(f"Создать новую заявку:\n{url}")


@router.message(Command("tasks"), F.chat.type == "private")
async def cmd_tasks(message: Message):
    from app.core.database import AsyncSessionLocal
    from app.models.user import User
    from app.models.student_task import StudentTask, TaskStatus
    from app.models.student import Student
    from app.models.mentor_assignment import MentorAssignment
    from sqlalchemy import select

    tg_id = str(message.from_user.id)

    async with AsyncSessionLocal() as db:
        user_result = await db.execute(select(User).where(User.telegram_id == tg_id))
        user = user_result.scalar_one_or_none()

        if not user:
            await message.answer("❌ Ваш Telegram не привязан к аккаунту CRM. Обратитесь к администратору.")
            return

        student_ids_result = await db.execute(
            select(MentorAssignment.student_id).where(
                MentorAssignment.mentor_id == user.id,
                MentorAssignment.is_active == True,  # noqa
            )
        )
        student_ids = [r[0] for r in student_ids_result.all()]

        if not student_ids:
            await message.answer("У вас нет назначенных студентов.")
            return

        tasks_result = await db.execute(
            select(StudentTask, Student.full_name)
            .join(Student, Student.id == StudentTask.student_id)
            .where(
                StudentTask.student_id.in_(student_ids),
                StudentTask.status == TaskStatus.open,
            )
            .order_by(StudentTask.created_at)
            .limit(20)
        )
        rows = tasks_result.all()

    if not rows:
        await message.answer("✅ Открытых задач нет!")
        return

    lines = ["📋 *Открытые задачи:*\n"]
    for task, student_name in rows:
        lines.append(f"• [{student_name}] {task.task_text}")

    await message.answer("\n".join(lines), parse_mode="Markdown")


@router.message()
async def on_message(message: Message, update_id: int):
    """Catch-all: group messages (and any private message that isn't one of
    the mentor commands above) get ingested into the client inbox."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.telegram_chat import TelegramChatStatus
    from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
    from app.models.telegram_message import TelegramMessage
    from app.services.telegram_ingest import ingest_message

    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, message.chat)

        if chat.status == TelegramChatStatus.unbound:
            await db.commit()
            if message.chat.type == "private":
                await message.answer(
                    "Этот чат пока не привязан к профилю студента.\n"
                    "Попросите вашего менеджера прислать вам ссылку для подключения."
                )
            return

        existing = await db.execute(select(TelegramMessage).where(TelegramMessage.update_id == update_id))
        if existing.scalar_one_or_none() is not None:
            logger.info("Duplicate Telegram update_id=%s, skipping (webhook retry)", update_id)
            return

        session_result = await db.execute(
            select(TelegramChatSession)
            .where(
                TelegramChatSession.chat_id == chat.id,
                TelegramChatSession.status == TelegramSessionStatus.active,
            )
            .order_by(TelegramChatSession.opened_at.desc())
        )
        session = session_result.scalars().first()

        row = await ingest_message(
            db, bot=get_bot(), chat=chat, session=session, message=message, update_id=update_id
        )

        if chat.status != TelegramChatStatus.paused:
            from app.services.telegram_extraction import extract_insight_from_message

            await extract_insight_from_message(db, row)

        await db.commit()

        if message.chat.type == "private" and (
            message.photo or message.document or message.voice or message.video_note
        ):
            await message.answer("📎 Файл получен, обрабатывается.")


async def webhook_health_loop(interval_seconds: int = 600) -> None:
    """Telegram delivers updates silently or not at all — if the tunnel/
    webhook breaks there's no error anywhere in the app, messages just stop
    arriving. Poll getWebhookInfo periodically so breakage shows up in logs."""
    import asyncio

    b = get_bot()
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            info = await b.get_webhook_info()
            if info.last_error_message:
                logger.warning(
                    "Telegram webhook has a recent error: %s (at %s)",
                    info.last_error_message,
                    info.last_error_date,
                )
            if info.url != settings.TELEGRAM_WEBHOOK_URL:
                logger.warning(
                    "Telegram webhook URL mismatch: registered=%s expected=%s — tunnel likely restarted",
                    info.url,
                    settings.TELEGRAM_WEBHOOK_URL,
                )
        except Exception:
            logger.exception("Failed to check Telegram webhook health")


async def send_notification(telegram_id: str, text: str) -> None:
    if not telegram_id or not settings.TELEGRAM_BOT_TOKEN:
        return
    try:
        b = get_bot()
        await b.send_message(chat_id=telegram_id, text=text)
    except Exception as e:
        logger.warning(f"Failed to send Telegram notification to {telegram_id}: {e}")
