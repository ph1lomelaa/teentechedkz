"""Immutable generated acts and auditable mail attempts; drafts retain their input."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ServiceAct(Base):
    __tablename__ = "service_acts"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    contract_link_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("trustme_contract_links.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    template_version: Mapped[str] = mapped_column(String(30), default="2026-11-v1")
    snapshot: Mapped[dict] = mapped_column(JSON)
    file_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A new act may explicitly supersede a previously generated one.
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("service_acts.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    shared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ActMailAttempt(Base):
    __tablename__ = "act_mail_attempts"
    # Client-generated UUID is an idempotency key, retained across retries.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    act_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("service_acts.id", ondelete="CASCADE"), index=True)
    sent_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    recipient: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20))
    message_id: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
