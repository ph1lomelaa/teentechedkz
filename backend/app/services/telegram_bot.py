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
    else:
        chat.title = tg_chat.title or getattr(tg_chat, "full_name", None) or chat.title
    return chat


@router.my_chat_member()
async def on_my_chat_member(event: ChatMemberUpdated):
    """Fires whenever the bot's own membership status changes in a chat —
    added to a group, removed, promoted to admin — regardless of privacy
    mode or admin rights. This is how we detect "someone added the bot"."""
    from app.core.database import AsyncSessionLocal
    from app.models.telegram_chat import TelegramChatType

    new_status = event.new_chat_member.status if event.new_chat_member else None
    bot_is_in_chat = new_status in _JOINED_STATUSES
    adder_id = event.from_user.id if event.from_user else None

    student = None
    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, event.chat)
        try:
            me = await get_bot().get_me()
            chat.privacy_mode_disabled = bool(getattr(me, "can_read_all_group_messages", False))
        except Exception:
            logger.warning("Failed to refresh Telegram privacy-mode status", exc_info=True)

        # `?startgroup=<code>` does NOT deliver a `/start <code>` message to the
        # group — only this update fires. So when a linked mentor adds the bot
        # to a group, match them to their most recent group-setup pairing and
        # attach the group to that student here (see consume_pairing_for_adder).
        if bot_is_in_chat and chat.chat_type in (TelegramChatType.group, TelegramChatType.supergroup):
            student = await consume_pairing_for_adder(db, chat, adder_id)
        await db.commit()
        logger.info(f"Telegram chat registered: chat_id={event.chat.id} status={chat.status}")

    if student:
        # Бот молчит в клиентских группах без исключений — подтверждение
        # подключения видно менторам в CRM (карточка студента), не в чате.
        logger.info("Telegram group connected via startgroup: chat_id=%s student_id=%s", event.chat.id, student.id)


async def consume_pairing_code(db, code: str, chat, now: datetime | None = None):
    """Consume a one-time code and atomically make this chat's session current.

    Kept separate from aiogram delivery so pairing and reassignment semantics
    can be integration-tested without impersonating a real Telegram user.
    """
    from sqlalchemy import select
    from app.models.telegram_pairing_code import TelegramPairingCode
    from app.models.telegram_chat import TelegramChatStatus
    from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
    from app.models.student import Student

    used_at = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(TelegramPairingCode)
        .where(TelegramPairingCode.code == code)
        .with_for_update()
    )
    pairing = result.scalar_one_or_none()
    # Split-out checks so the logs say *why* a group failed to connect — the
    # single most common support question ("бот не подключается"). See п.8.
    if not pairing:
        logger.warning("Telegram pairing failed: code not found (chat_id=%s)", chat.chat_id)
        return None
    if pairing.used_at is not None:
        logger.warning("Telegram pairing failed: code already used (chat_id=%s)", chat.chat_id)
        return None
    if pairing.expires_at < used_at:
        logger.warning("Telegram pairing failed: code expired (chat_id=%s)", chat.chat_id)
        return None

    return await _bind_chat_to_pairing(db, pairing, chat, used_at)


async def _bind_chat_to_pairing(db, pairing, chat, used_at):
    """Attach `chat` to the student behind `pairing`: close any prior active
    session, mark the pairing used, flip the chat to active and open a fresh
    session. Shared by code-based (`consume_pairing_code`) and adder-based
    (`consume_pairing_for_adder`) attach so both behave identically."""
    from sqlalchemy import select
    from app.models.telegram_chat import TelegramChatStatus
    from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
    from app.models.student import Student

    student = await db.get(Student, pairing.student_id)
    if not student:
        return None

    active_result = await db.execute(
        select(TelegramChatSession).where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
    )
    for existing_session in active_result.scalars().all():
        existing_session.status = TelegramSessionStatus.closed
        existing_session.closed_at = used_at

    pairing.used_at = used_at
    chat.status = TelegramChatStatus.active
    db.add(
        TelegramChatSession(
            chat_id=chat.id,
            student_id=pairing.student_id,
            opened_by=pairing.created_by,
        )
    )
    await db.flush()
    return student


async def consume_pairing_for_adder(db, chat, adder_tg_user_id, now: datetime | None = None):
    """Attach a freshly-added group to a student when the bot was added via a
    `?startgroup=<code>` link. Telegram drops the startgroup payload, so instead
    of a code we match the person who ADDED the bot (`my_chat_member.from_user`)
    to their most recent still-valid group-setup pairing. Only ever attaches an
    unbound chat — never hijacks one already bound to a student."""
    from sqlalchemy import select
    from app.models.telegram_chat import TelegramChatStatus
    from app.models.telegram_pairing_code import TelegramPairingCode
    from app.models.user import User

    if adder_tg_user_id is None or chat.status != TelegramChatStatus.unbound:
        return None

    used_at = now or datetime.now(timezone.utc)
    adder_result = await db.execute(select(User).where(User.telegram_id == str(adder_tg_user_id)))
    adder = adder_result.scalar_one_or_none()
    if not adder:
        logger.info("Telegram auto-attach skipped: adder %s is not a linked staff user", adder_tg_user_id)
        return None

    pairing_result = await db.execute(
        select(TelegramPairingCode)
        .where(
            TelegramPairingCode.created_by == adder.id,
            TelegramPairingCode.used_at.is_(None),
            TelegramPairingCode.expires_at > used_at,
        )
        .order_by(TelegramPairingCode.created_at.desc())
        .limit(1)
        .with_for_update()
    )
    pairing = pairing_result.scalar_one_or_none()
    if not pairing:
        logger.info("Telegram auto-attach skipped: no pending pairing for adder %s (chat_id=%s)", adder.id, chat.chat_id)
        return None

    return await _bind_chat_to_pairing(db, pairing, chat, used_at)


def is_invite_link_usable(link, now: datetime | None = None) -> bool:
    """A personal invite link works while it's neither consumed, revoked, nor
    past its expiry. Pure so it can be unit-tested without Telegram or a DB."""
    now = now or datetime.now(timezone.utc)
    if link.used_at is not None or link.revoked:
        return False
    return link.expires_at is None or link.expires_at > now


# Telegram member statuses that mean "this user is now in the group".
_JOINED_STATUSES = frozenset({"member", "administrator", "creator"})


async def bind_invite_join(
    db,
    invite_link_url: str,
    chat,
    tg_user_id,
    tg_username: str | None = None,
    now: datetime | None = None,
):
    """Consume a personal invite link: capture the joining user's Telegram id
    onto the student card and bind this chat to that student. Idempotent for a
    repeat join of an already-linked user. Kept separate from aiogram delivery
    so it can be integration-tested without a real Telegram user (mirrors
    `consume_pairing_code`)."""
    from sqlalchemy import select
    from app.models.telegram_invite_link import TelegramInviteLink
    from app.models.telegram_chat import TelegramChatStatus
    from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
    from app.models.student import Student

    used_at = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(TelegramInviteLink)
        .where(TelegramInviteLink.invite_link == invite_link_url)
        .with_for_update()
    )
    link = result.scalar_one_or_none()
    if not link or not is_invite_link_usable(link, used_at):
        return None
    if int(link.tg_chat_id) != int(chat.chat_id):
        logger.warning(
            "Invite link chat mismatch: stored=%s event=%s",
            link.tg_chat_id,
            chat.chat_id,
        )
        return None

    student = await db.get(Student, link.student_id)
    if not student:
        return None

    link.used_at = used_at
    link.joined_tg_user_id = str(tg_user_id)
    link.joined_username = tg_username

    student.telegram_user_id = str(tg_user_id)
    student.telegram_username = tg_username
    student.telegram_linked_at = used_at

    active_result = await db.execute(
        select(TelegramChatSession).where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
    )
    for existing_session in active_result.scalars().all():
        existing_session.status = TelegramSessionStatus.closed
        existing_session.closed_at = used_at

    chat.status = TelegramChatStatus.active
    db.add(
        TelegramChatSession(
            chat_id=chat.id,
            student_id=link.student_id,
            opened_by=link.created_by,
        )
    )
    await db.flush()
    return student


@router.chat_member()
async def on_chat_member(event: ChatMemberUpdated):
    """A user's membership in a group changed. When someone joins through one of
    our personal invite links, bind their Telegram id to the student the link
    was made for — silently, in the background."""
    from app.core.database import AsyncSessionLocal
    from app.models.audit_log import AuditAction
    from app.services.audit import record_audit

    invite = event.invite_link
    if invite is None:
        return
    new_status = event.new_chat_member.status if event.new_chat_member else None
    if new_status not in _JOINED_STATUSES:
        return
    joined = event.new_chat_member.user

    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, event.chat)
        student = await bind_invite_join(db, invite.invite_link, chat, joined.id, joined.username)
        if student:
            record_audit(
                db,
                action=AuditAction.telegram_linked,
                target_type="student",
                target_id=str(student.id),
                meta={"tg_user_id": str(joined.id), "username": joined.username},
            )
        await db.commit()

    if student:
        try:
            await get_bot().revoke_chat_invite_link(event.chat.id, invite.invite_link)
        except Exception:
            logger.warning("Failed to revoke used invite link", exc_info=True)


@router.message(CommandStart(deep_link=True))
async def on_start_with_payload(message: Message, command):
    """Deep-link pairing: t.me/<bot>?start=<code> — binds this chat to the
    student the code was generated for, without the manager having to know
    the chat_id."""
    from app.core.database import AsyncSessionLocal

    code = (command.args or "").strip()

    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, message.chat)
        student = await consume_pairing_code(db, code, chat)
        await db.commit()

    # Бот молчит в клиентских группах без исключений — подтверждение или
    # причина неудачи видны менторам в CRM/логах, не в самом чате.
    if student:
        logger.info("Telegram group connected via /start code: chat_id=%s student_id=%s", message.chat.id, student.id)
    else:
        logger.warning(
            "Telegram group did NOT connect: chat_id=%s code_present=%s — код истёк/"
            "использован либо группа уже привязана; проверьте карточку ученика в CRM",
            message.chat.id,
            bool(code),
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
        # Staff tool: mentor commands stay interactive.
        await message.answer(
            "👋 Добро пожаловать в TeenTechEd CRM!\n\n"
            "Доступные команды:\n"
            "/status <телефон> — статус студента\n"
            "/new — создать новую заявку\n"
            "/tasks — мои открытые задачи\n"
        )
        return

    # Client side is silent (P4 главное правило): no greeting, no prompts.
    return


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


@router.message(F.migrate_from_chat_id)
async def on_migrate_from_chat_id(message: Message):
    """Telegram silently reassigns a brand-new numeric chat_id when a basic
    group is migrated to a supergroup (e.g. an admin enables a supergroup-only
    setting). `telegram_chats.chat_id` is looked up by that numeric id
    (`_upsert_chat`), so without this the old bound chat row is orphaned:
    every later message arrives under the new id, doesn't match, and
    `on_message` below creates a fresh *unbound* row for it — silently
    dropping every real message from the group from then on. Rename the
    existing row in place instead, so the binding, session and message
    history all carry over to the new id."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.telegram_chat import TelegramChat, TelegramChatType

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(TelegramChat).where(TelegramChat.chat_id == message.migrate_from_chat_id)
        )
        chat = result.scalar_one_or_none()
        if chat is None:
            logger.warning(
                "Telegram migration event for unknown chat_id=%s (new_chat_id=%s)",
                message.migrate_from_chat_id, message.chat.id,
            )
            return
        chat.chat_id = message.chat.id
        chat.chat_type = TelegramChatType.supergroup
        await db.commit()
        logger.info(
            "Telegram group migrated to supergroup: old_chat_id=%s new_chat_id=%s chat=%s",
            message.migrate_from_chat_id, message.chat.id, chat.id,
        )


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
    from app.services.queue import get_arq_pool

    if message.migrate_to_chat_id:
        # System notice for the *old* chat_id, fired right before the actual
        # migration message lands (see on_migrate_from_chat_id above) — no
        # real content, just skip it instead of storing a blank message row.
        return

    async with AsyncSessionLocal() as db:
        chat = await _upsert_chat(db, message.chat)

        if chat.status == TelegramChatStatus.unbound:
            # Silent: an unbound chat is just ignored, no reply to the client.
            await db.commit()
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

        row, attachment = await ingest_message(
            db, chat=chat, session=session, message=message, update_id=update_id
        )
        chat_paused = chat.status == TelegramChatStatus.paused
        row_id = row.id
        attachment_id = attachment.id if attachment else None

        await db.commit()

    # Heavy work (Telegram file download, Deepgram transcription, MinIO
    # upload, AI insight extraction) runs in the separate `worker` process —
    # never block the Telegram webhook response on it (Telegram retries/backs
    # off webhooks that don't answer quickly).
    pool = await get_arq_pool()
    if attachment_id is not None:
        await pool.enqueue_job("process_telegram_attachment_task", str(attachment_id))
    elif not chat_paused:
        await pool.enqueue_job("extract_telegram_insight_task", str(row_id))
    # No "file received" acknowledgement — the bot stays silent for clients.


async def webhook_health_loop(interval_seconds: int = 600) -> None:
    """Telegram delivers updates silently or not at all — if the tunnel/
    webhook breaks there's no error anywhere in the app, messages just stop
    arriving. Poll getWebhookInfo periodically; if the registered URL drifted
    (e.g. after a tunnel/proxy restart), re-register it automatically rather
    than just logging the drift and leaving the bot broken until someone
    notices and restarts the backend by hand."""
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
                    "Telegram webhook URL mismatch: registered=%s expected=%s — re-registering",
                    info.url,
                    settings.TELEGRAM_WEBHOOK_URL,
                )
                try:
                    await b.set_webhook(
                        settings.TELEGRAM_WEBHOOK_URL,
                        secret_token=settings.TELEGRAM_WEBHOOK_SECRET or None,
                        allowed_updates=["message", "my_chat_member", "chat_member"],
                    )
                    logger.info("Telegram webhook re-registered: %s", settings.TELEGRAM_WEBHOOK_URL)
                except Exception:
                    logger.exception("Failed to re-register Telegram webhook")
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
