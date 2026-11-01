import uuid
from datetime import datetime, date, timezone
from decimal import Decimal
from sqlalchemy import String, Numeric, Date, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class PaymentType(str, enum.Enum):
    client_payment = "client_payment"
    mentor_payout = "mentor_payout"
    english_payment = "english_payment"


class PaymentStatus(str, enum.Enum):
    paid = "paid"
    pending = "pending"
    to_be_paid = "to_be_paid"


class PaymentMethod(str, enum.Enum):
    kaspi = "kaspi"
    bank = "bank"
    cash = "cash"
    other = "other"


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"))
    type: Mapped[PaymentType] = mapped_column(SAEnum(PaymentType, name="payment_type"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(10), default="KZT")
    status: Mapped[PaymentStatus] = mapped_column(SAEnum(PaymentStatus, name="payment_status"))
    paid_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    recorded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Строка графика, которую закрывает этот платёж. Платежи, внесённые до
    # графика (старый раздел «Финансы»), остаются без неё.
    schedule_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payment_schedule_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    method: Mapped[PaymentMethod | None] = mapped_column(SAEnum(PaymentMethod, name="payment_method"), nullable=True)

    contract: Mapped["Contract"] = relationship(back_populates="payments")
    mentor: Mapped["User | None"] = relationship(foreign_keys=[mentor_id])
    recorder: Mapped["User"] = relationship(foreign_keys=[recorded_by])
