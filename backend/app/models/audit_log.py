"""Append-only security audit log (Этап 0.1).

Records who did what to whom and when for security-sensitive actions:
login (success/failure), password change/reset, access grant/toggle,
session termination, and — later — Telegram/Google (un)linking.

The table is write-once: rows are never updated or deleted from application
code. `actor_user_id` is nullable because some events (a failed login for an
unknown email) have no authenticated actor; `actor_email` keeps a snapshot so
the record stays readable even if the user is later removed.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AuditAction(str, enum.Enum):
    login_success = "login_success"
    login_failed = "login_failed"
    logout = "logout"
    sessions_revoked = "sessions_revoked"
    password_changed = "password_changed"
    password_reset = "password_reset"
    access_granted = "access_granted"
    access_toggled = "access_toggled"
    invite_created = "invite_created"
    invite_accepted = "invite_accepted"
    # placeholders for later phases (Telegram / Google) so wiring is uniform
    telegram_linked = "telegram_linked"
    telegram_unlinked = "telegram_unlinked"
    google_linked = "google_linked"
    google_unlinked = "google_unlinked"
    agreement_published = "agreement_published"
    agreement_signed = "agreement_signed"


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    action: Mapped[AuditAction] = mapped_column(
        SAEnum(AuditAction, name="audit_action"), index=True
    )
    # Who performed it (nullable: system events / failed login for unknown email).
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    actor_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Who/what it was performed on (often the same user; nullable for global events).
    target_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    target_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
