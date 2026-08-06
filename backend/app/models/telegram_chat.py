from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, DateTime, Enum as SAEnum, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TelegramChatType(str, enum.Enum):
    private = "private"
    group = "group"
    supergroup = "supergroup"


class TelegramChatStatus(str, enum.Enum):
    unbound = "unbound"
    active = "active"
    paused = "paused"
    closed = "closed"


class TelegramChat(Base):
    __tablename__ = "telegram_chats"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    chat_type: Mapped[TelegramChatType] = mapped_column(SAEnum(TelegramChatType, name="telegram_chat_type"))
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    onboarding_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    onboarding_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    onboarding_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    privacy_mode_disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[TelegramChatStatus] = mapped_column(
        SAEnum(TelegramChatStatus, name="telegram_chat_status"),
        default=TelegramChatStatus.unbound,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    sessions: Mapped[list["TelegramChatSession"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", order_by="TelegramChatSession.opened_at.desc()"
    )
    messages: Mapped[list["TelegramMessage"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", order_by="TelegramMessage.created_at"
    )
