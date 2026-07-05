from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Enum as SAEnum, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TelegramMessageType(str, enum.Enum):
    text = "text"
    photo = "photo"
    document = "document"
    voice = "voice"
    video_note = "video_note"
    other = "other"


class TelegramMessage(Base):
    __tablename__ = "telegram_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("telegram_chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("telegram_chat_sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    telegram_message_id: Mapped[int] = mapped_column(BigInteger)
    update_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    sender_tg_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sender_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_type: Mapped[TelegramMessageType] = mapped_column(
        SAEnum(TelegramMessageType, name="telegram_message_type")
    )
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    chat: Mapped["TelegramChat"] = relationship(back_populates="messages")
    session: Mapped["TelegramChatSession | None"] = relationship(back_populates="messages")
    attachments: Mapped[list["TelegramAttachment"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )
