from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AddendumStatus(str, enum.Enum):
    draft = "draft"
    sent_to_customer = "sent_to_customer"
    customer_signed = "customer_signed"
    company_signed = "company_signed"
    active = "active"
    renewal_due = "renewal_due"
    completed = "completed"
    cancelled = "cancelled"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ContractAddendum(Base):
    __tablename__ = "contract_addenda"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    number: Mapped[str] = mapped_column(String(80), unique=True)
    reason: Mapped[str] = mapped_column(Text)
    current_intake: Mapped[str | None] = mapped_column(String(80), nullable=True)
    new_intake: Mapped[str | None] = mapped_column(String(80), nullable=True)
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    programs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    transfer_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    transfer_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    resume_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    related_service_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    related_task_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[AddendumStatus] = mapped_column(
        SAEnum(AddendumStatus, name="addendum_status"), default=AddendumStatus.draft, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    document_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    customer_signed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    customer_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    company_signed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    company_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
