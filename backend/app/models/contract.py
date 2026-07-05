import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from sqlalchemy import String, Numeric, Boolean, Date, DateTime, ForeignKey, Text, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class PipelineStatus(str, enum.Enum):
    active_work = "active_work"
    on_visa = "on_visa"
    paused = "paused"
    changed_mind = "changed_mind"
    refund = "refund"
    unpaid = "unpaid"
    transferred_pipeline = "transferred_pipeline"
    ielts_retake = "ielts_retake"
    suspended = "suspended"
    no_status = "no_status"


class PaymentPlan(str, enum.Enum):
    full = "full"
    installments = "installments"


class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    signed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="KZT")
    payment_plan: Mapped[PaymentPlan | None] = mapped_column(SAEnum(PaymentPlan, name="payment_plan"), nullable=True)
    pipeline_status: Mapped[PipelineStatus] = mapped_column(
        SAEnum(PipelineStatus, name="pipeline_status"), default=PipelineStatus.no_status
    )
    mzk_manager_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    ielts_payment_included: Mapped[bool] = mapped_column(Boolean, default=False)
    english_sum: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    english_paid: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    client_remaining_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    client_remaining_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    mentor_total_owed: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="contracts")
    mzk_manager: Mapped["User | None"] = relationship(foreign_keys=[mzk_manager_id])
    payments: Mapped[list["Payment"]] = relationship(back_populates="contract", cascade="all, delete-orphan")
    applications: Mapped[list["Application"]] = relationship(back_populates="contract")
    services: Mapped[list["Service"]] = relationship(back_populates="contract")
