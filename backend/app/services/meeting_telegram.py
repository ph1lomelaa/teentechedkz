"""At-most-once Telegram notices for student meeting groups.

Telegram has no idempotency key. A delivery is reserved and committed before
calling the API; an interrupted `sending` state stays visible for manual review
instead of risking a duplicate after worker restart.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.meeting import Meeting, MeetingStatus
from app.models.meeting_telegram_delivery import MeetingTelegramDelivery
from app.models.telegram_chat import TelegramChat, TelegramChatStatus, TelegramChatType
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.user import User
from app.services.notify import notify, was_sent
from app.services.telegram_bot import get_bot

logger = logging.getLogger(__name__)
ALMATY = ZoneInfo("Asia/Almaty")


#: Напоминания за час: в группу ученика (Telegram) и ментору (колокольчик).
REMINDER_KINDS = ("reminder", "mentor_reminder")
#: Ещё не дошедшее «назначена» можно перевзвести — новое время или ссылка
#: попадут в него же, второго сообщения группа не увидит.
_UNDELIVERED = {"pending", "failed", "cancelled"}
#: Строка в `sending` дольше этого — воркер упал посреди отправки.
STUCK_SENDING_AFTER = timedelta(minutes=10)


def _add(db: AsyncSession, meeting: Meeting, kind: str, due_at: datetime, state: str, now: datetime) -> None:
    db.add(MeetingTelegramDelivery(meeting_id=meeting.id, kind=kind, due_at=due_at, state=state, updated_at=now))


async def queue_meeting_notices(
    db: AsyncSession, meeting: Meeting, *, rescheduled: bool = False, link_changed: bool = False,
) -> None:
    existing = {d.kind: d for d in (await db.execute(select(MeetingTelegramDelivery).where(
        MeetingTelegramDelivery.meeting_id == meeting.id))).scalars()}
    now = datetime.now(timezone.utc)
    if meeting.status == MeetingStatus.cancelled:
        for delivery in existing.values():
            if delivery.state == "pending":
                delivery.state = "cancelled"
                delivery.updated_at = now
        if "cancelled" not in existing and any(d.state == "sent" for d in existing.values()):
            _add(db, meeting, "cancelled", now, "pending", now)
        return

    restored = False
    cancelled_notice = existing.get("cancelled")
    if cancelled_notice is not None:
        # Отмену сняли. Освобождаем ключ "cancelled" под возможную будущую
        # отмену; если группа уже слышала «отменена», скажем, что встреча снова в силе.
        restored = cancelled_notice.state == "sent"
        if cancelled_notice.state == "pending":
            cancelled_notice.state = "cancelled"
        cancelled_notice.kind = f"cancelled:{now.isoformat()}"
        cancelled_notice.updated_at = now

    scheduled = existing.get("scheduled")
    if scheduled is None:
        _add(db, meeting, "scheduled", now, "pending", now)
    elif scheduled.state in _UNDELIVERED:
        scheduled.state = "pending"
        scheduled.due_at = now
        scheduled.error = None
        scheduled.updated_at = now
    elif restored:
        _add(db, meeting, f"restored:{now.isoformat()}", now, "pending", now)
    elif rescheduled:
        kind = f"rescheduled:{meeting.starts_at.isoformat()}"
        if kind not in existing:
            _add(db, meeting, kind, now, "pending", now)
        elif existing[kind].state == "pending":
            existing[kind].due_at = now
    elif link_changed and meeting.meeting_link:
        _add(db, meeting, f"link:{now.isoformat()}", now, "pending", now)

    reminder_at = meeting.starts_at - timedelta(hours=1)
    target = "pending" if reminder_at > now else "skipped"
    for kind in REMINDER_KINDS:
        reminder = existing.get(kind)
        if reminder is None:
            _add(db, meeting, kind, reminder_at, target, now)
        elif reminder.state == "sending":
            continue
        elif rescheduled or reminder.state in {"cancelled", "failed"}:
            # Новое время — новое напоминание (даже если старое ушло). После
            # снятия отмены или сбоя — взводим заново на текущее время.
            reminder.due_at = reminder_at
            reminder.state = target
            reminder.error = None
            reminder.updated_at = now


async def _group_for_student(db: AsyncSession, student_id):
    return (await db.execute(select(TelegramChat)
        .join(TelegramChatSession, TelegramChatSession.chat_id == TelegramChat.id)
        .where(TelegramChatSession.student_id == student_id,
               TelegramChatSession.status == TelegramSessionStatus.active,
               TelegramChat.status == TelegramChatStatus.active,
               TelegramChat.chat_type.in_([TelegramChatType.group, TelegramChatType.supergroup]))
        .order_by(TelegramChatSession.opened_at.desc()).limit(1))).scalar_one_or_none()


def _when(meeting: Meeting) -> str:
    return meeting.starts_at.astimezone(ALMATY).strftime("%d.%m.%Y в %H:%M")


def _prefix(kind: str) -> str:
    for marker, text in (("rescheduled:", "Встреча перенесена"), ("restored:", "Встреча снова в силе"),
                         ("link:", "Ссылка на встречу")):
        if kind.startswith(marker):
            return text
    return {"scheduled": "Встреча назначена", "reminder": "Через час встреча",
            "cancelled": "Встреча отменена"}[kind]


def _group_message(kind: str, meeting: Meeting, mentor: User | None) -> str:
    lines = [f"{_prefix(kind)}: {_when(meeting)} (Алматы)",
             f"Ментор: {mentor.name if mentor else 'не указан'}",
             f"Тема: {meeting.title}"]
    if kind != "cancelled":
        lines.append(f"Ссылка: {meeting.meeting_link}" if meeting.meeting_link
                     else "Ссылку на встречу ментор пришлёт отдельно.")
    return "\n".join(lines)


async def _release_stuck(db: AsyncSession, now: datetime) -> None:
    stuck = (await db.execute(select(MeetingTelegramDelivery).where(
        MeetingTelegramDelivery.state == "sending",
        MeetingTelegramDelivery.updated_at < now - STUCK_SENDING_AFTER))).scalars().all()
    for delivery in stuck:
        # Не повторяем: Telegram мог успеть принять сообщение. Видно в БД.
        delivery.state = "failed"
        delivery.error = "Отправка прервана (воркер перезапущен); повтор не делался, чтобы не задвоить"
        delivery.updated_at = now


async def _warn_mentor_no_group(db: AsyncSession, meeting: Meeting) -> None:
    recipient = meeting.mentor_id or meeting.created_by
    if not recipient:
        return
    marker = f"[meeting:{meeting.id}]"
    if await was_sent(db, recipient, kind="meeting_telegram_failed", body_contains=marker):
        return
    notify(db, recipient, kind="meeting_telegram_failed",
           title="Ученик не получил уведомление о встрече",
           body=f"{meeting.title} — {_when(meeting)}: у ученика нет активной Telegram-группы. "
                f"Сообщите о встрече сами. {marker}",
           link="/workspace/meetings", priority="high")


async def send_due_notices(db: AsyncSession) -> int:
    now = datetime.now(timezone.utc)
    await _release_stuck(db, now)
    due = list((await db.execute(select(MeetingTelegramDelivery)
        .where(MeetingTelegramDelivery.state == "pending", MeetingTelegramDelivery.due_at <= now)
        .order_by(MeetingTelegramDelivery.due_at).limit(50)
        .with_for_update(skip_locked=True))).scalars())
    # Reserve the whole locked batch before releasing any row locks. Otherwise
    # a second worker could pick the still-pending tail after the first send.
    for delivery in due:
        delivery.state = "sending"
        delivery.updated_at = now
    await db.commit()
    sent = 0
    for delivery in due:
        meeting = await db.get(Meeting, delivery.meeting_id)
        is_reminder = delivery.kind in REMINDER_KINDS
        if not meeting or (meeting.status != MeetingStatus.scheduled and delivery.kind != "cancelled") \
                or (is_reminder and meeting.starts_at <= now):
            delivery.state = "cancelled"
            delivery.updated_at = now
            await db.commit()
            continue
        if delivery.kind == "mentor_reminder":
            if meeting.mentor_id:
                notify(db, meeting.mentor_id, kind="meeting_reminder", title="Через час встреча",
                       body=f"{meeting.title} — {_when(meeting)} [meeting:{meeting.id}]",
                       link="/workspace/meetings", priority="high")
                delivery.state = "sent"
                sent += 1
            else:
                delivery.state = "skipped"
            delivery.updated_at = now
            await db.commit()
            continue
        group = await _group_for_student(db, meeting.student_id)
        if not group:
            delivery.state = "failed"
            delivery.error = "У ученика нет активной Telegram-группы"
            delivery.updated_at = now
            await _warn_mentor_no_group(db, meeting)
            await db.commit()
            continue
        mentor = await db.get(User, meeting.mentor_id) if meeting.mentor_id else None
        delivery.chat_id = group.chat_id
        delivery.updated_at = now
        try:
            response = await get_bot().send_message(
                chat_id=group.chat_id, text=_group_message(delivery.kind, meeting, mentor))
            delivery.state = "sent"
            delivery.telegram_message_id = response.message_id
            sent += 1
        except Exception as exc:
            logger.exception("Meeting Telegram notice failed: %s", delivery.id)
            delivery.state = "failed"
            delivery.error = str(exc)[:1000]
        delivery.updated_at = datetime.now(timezone.utc)
        await db.commit()
    await db.commit()
    return sent


async def meeting_telegram_loop() -> None:
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await send_due_notices(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Meeting Telegram delivery pass failed")
        await asyncio.sleep(60)
