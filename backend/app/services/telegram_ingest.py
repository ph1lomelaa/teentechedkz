from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
from app.models.telegram_chat import TelegramChat
from app.models.telegram_chat_session import TelegramChatSession
from app.models.telegram_message import TelegramMessage, TelegramMessageType
from app.services.minio_service import minio_upload_raw

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


async def ingest_message(
    db: AsyncSession,
    bot: Bot,
    chat: TelegramChat,
    session: TelegramChatSession | None,
    message: Message,
    update_id: int,
) -> TelegramMessage:
    row = TelegramMessage(
        chat_id=chat.id,
        session_id=session.id if session else None,
        telegram_message_id=message.message_id,
        update_id=update_id,
        sender_tg_id=message.from_user.id if message.from_user else None,
        sender_name=message.from_user.full_name if message.from_user else None,
        message_type=_message_type(message),
        raw_text=message.text or message.caption,
        raw_payload=message.model_dump(mode="json", exclude_none=True),
    )
    db.add(row)
    await db.flush()

    file_ref = None
    filename = "file"
    mime_type = None
    if message.photo:
        file_ref = message.photo[-1]
        filename = f"{file_ref.file_id}.jpg"
        mime_type = "image/jpeg"
    elif message.document:
        file_ref = message.document
        filename = message.document.file_name or filename
        mime_type = message.document.mime_type
    elif message.voice:
        file_ref = message.voice
        filename = f"{file_ref.file_id}.ogg"
        mime_type = message.voice.mime_type or "audio/ogg"
    elif message.video_note:
        file_ref = message.video_note
        filename = f"{file_ref.file_id}.mp4"
        mime_type = "video/mp4"

    if file_ref is not None:
        attachment = TelegramAttachment(
            message_id=row.id,
            telegram_file_id=file_ref.file_id,
            mime_type=mime_type,
            file_size=getattr(file_ref, "file_size", None),
        )
        db.add(attachment)
        await db.flush()
        try:
            tg_file = await bot.get_file(file_ref.file_id)
            buffer = await bot.download_file(tg_file.file_path)
            content = buffer.read()
            storage_path = await minio_upload_raw(
                content=content, chat_id=chat.id, filename=filename, mime_type=mime_type or "application/octet-stream"
            )
            attachment.storage_path = storage_path
            attachment.status = TelegramAttachmentStatus.downloaded
        except Exception:
            logger.exception("Failed to download Telegram attachment %s", file_ref.file_id)
            attachment.status = TelegramAttachmentStatus.failed

    return row
