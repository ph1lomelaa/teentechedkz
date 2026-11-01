"""Durable finance mail outbox; SMTP acceptance is not proof of delivery."""
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


def now():
    return datetime.now(timezone.utc)


class FinanceMailDelivery(Base):
    __tablename__ = 'finance_mail_deliveries'
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    recipient: Mapped[str] = mapped_column(String(320))
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('students.id', ondelete='CASCADE'), index=True)
    contract_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('contracts.id', ondelete='SET NULL'), nullable=True)
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    html: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default='pending', index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: now() + timedelta(hours=24))
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class FinanceMailEvent(Base):
    __tablename__ = 'finance_mail_events'
    __table_args__ = (UniqueConstraint('event_id', 'recipient_id', name='uq_finance_mail_event_recipient'),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    delivery_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('finance_mail_deliveries.id', ondelete='CASCADE'), index=True)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('finance_change_events.id', ondelete='CASCADE'), index=True)
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
