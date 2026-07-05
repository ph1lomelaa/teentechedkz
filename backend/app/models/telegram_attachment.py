from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TelegramAttachmentStatus(str, enum.Enum):
    pending = "pending"
    downloaded = "downloaded"
    parsed = "parsed"
    failed = "failed"


class TelegramAttachment(Base):
    __tablename__ = "telegram_attachments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("telegram_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_file_id: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    storage_path: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    status: Mapped[TelegramAttachmentStatus] = mapped_column(
        SAEnum(TelegramAttachmentStatus, name="telegram_attachment_status"),
        default=TelegramAttachmentStatus.pending,
        nullable=False,
    )
    parsed_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    message: Mapped["TelegramMessage"] = relationship(back_populates="attachments")
