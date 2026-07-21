"""Personal group invite link that binds the joining Telegram user to a student
(Приоритет 4).

A manager generates a `createChatInviteLink(member_limit=1)` for one student in
a specific group. When that user joins, the `chat_member` update carries the
invite link they used; we match it here, capture their Telegram user id onto the
student card, and revoke the link. Only the invite URL is needed to match —
Telegram echoes it back in the join event.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TelegramInviteLink(Base):
    __tablename__ = "telegram_invite_links"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    # The group the student is invited into. Stored as the raw Telegram chat id
    # so link creation doesn't depend on the chat already existing in our tables.
    tg_chat_id: Mapped[int] = mapped_column(BigInteger, index=True)
    invite_link: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked: Mapped[bool] = mapped_column(default=False)
    # Who actually joined through it (for the "expected vs actual" check).
    joined_tg_user_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    joined_username: Mapped[str | None] = mapped_column(String(150), nullable=True)

    student: Mapped["Student"] = relationship()
