from __future__ import annotations

import logging

from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.telegram_attachment import TelegramAttachment
from app.models.telegram_chat import TelegramChat
from app.models.telegram_chat_session import TelegramChatSession
from app.models.telegram_message import TelegramMessage, TelegramMessageType

logger = logging.getLogger(__name__)


def _message_type(message: Message) -> TelegramMessageType:
    if message.photo:
        return TelegramMessageType.photo
    if message.document:
        return TelegramMessageType.document
    if message.voice:
        return TelegramMessageType.voice
    if message.video_note:
        return TelegramMessageType.video_note
    if message.text:
        return TelegramMessageType.text
    return TelegramMessageType.other


def _extract_file_ref(message: Message) -> tuple[object | None, str, str | None]:
    """Returns (file_ref, filename, mime_type) for the message's attachment, if any."""
    if message.photo:
        file_ref = message.photo[-1]
        return file_ref, f"{file_ref.file_id}.jpg", "image/jpeg"
    if message.document:
        return message.document, message.document.file_name or "file", message.document.mime_type
    if message.voice:
        file_ref = message.voice
        return file_ref, f"{file_ref.file_id}.ogg", message.voice.mime_type or "audio/ogg"
    if message.video_note:
        file_ref = message.video_note
        return file_ref, f"{file_ref.file_id}.mp4", "video/mp4"
    return None, "file", None


async def ingest_message(
    db: AsyncSession,
    chat: TelegramChat,
    session: TelegramChatSession | None,
    message: Message,
    update_id: int,
) -> tuple[TelegramMessage, TelegramAttachment | None]:
    """Fast, DB-only ingestion — creates the message row and (if present) a
    `pending` attachment row. Downloading the file from Telegram, transcribing
    voice/video-note audio, and uploading to MinIO all happen later in the
    `worker` process (see app/worker.py: process_telegram_attachment_task) so
    a burst of incoming media never blocks the webhook response."""
    raw_text = message.text or message.caption or ""
    message_type = _message_type(message)

    row = TelegramMessage(
        chat_id=chat.id,
        session_id=session.id if session else None,
        telegram_message_id=message.message_id,
        update_id=update_id,
        sender_tg_id=message.from_user.id if message.from_user else None,
        sender_name=message.from_user.full_name if message.from_user else None,
        message_type=message_type,
        raw_text=raw_text,
        raw_payload=message.model_dump(mode="json", exclude_none=True),
    )
    db.add(row)
    await db.flush()

    file_ref, filename, mime_type = _extract_file_ref(message)
    attachment = None
    if file_ref is not None:
        attachment = TelegramAttachment(
            message_id=row.id,
            telegram_file_id=file_ref.file_id,
            file_name=filename,
            mime_type=mime_type,
            file_size=getattr(file_ref, "file_size", None),
        )
        db.add(attachment)
        await db.flush()

    return row, attachment
