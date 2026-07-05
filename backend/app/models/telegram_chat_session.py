from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TelegramSessionStatus(str, enum.Enum):
    active = "active"
    closed = "closed"


class TelegramChatSession(Base):
    __tablename__ = "telegram_chat_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("telegram_chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[TelegramSessionStatus] = mapped_column(
        SAEnum(TelegramSessionStatus, name="telegram_session_status"),
        default=TelegramSessionStatus.active,
        nullable=False,
    )
    opened_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    chat: Mapped["TelegramChat"] = relationship(back_populates="sessions")
    student: Mapped["Student | None"] = relationship()
    opener: Mapped["User | None"] = relationship(foreign_keys=[opened_by])
    messages: Mapped[list["TelegramMessage"]] = relationship(back_populates="session")
