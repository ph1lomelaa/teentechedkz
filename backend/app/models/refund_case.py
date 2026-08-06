"""Возвратные кейсы (регламент МЗК, раздел 6).

Уровень сложности присваивается вручную уполномоченным лицом по критериям
регламента (стандартность, оспаривание объёма, угроза суда и т.п.) — НЕ по
времени/SLA. Бонусы фиксированы регламентом: жёлтый 10000₸, оранжевый 15000₸,
красный 25000₸ (RefundLevel.bonus_amount).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, String, DateTime, ForeignKey, Integer, Numeric, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.reward_defaults import DEFAULT_REFUND_BONUS


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RefundLevel(str, enum.Enum):
    yellow = "yellow"
    orange = "orange"
    red = "red"

    @property
    def bonus_amount(self) -> int:
        """Ставка по умолчанию; действующая — в reward_rules."""
        return DEFAULT_REFUND_BONUS[self.value]


class RefundCaseStatus(str, enum.Enum):
    draft = "draft"
    submitted = "submitted"
    registered = "registered"
    under_review = "under_review"
    awaiting_documents = "awaiting_documents"
    awaiting_approval = "awaiting_approval"
    negotiation = "negotiation"
    decision_made = "decision_made"
    awaiting_execution = "awaiting_execution"
    executed = "executed"
    rejected = "rejected"
    closed = "closed"
    # Backward-compatible names for existing integrations and historical tests.
    open = "registered"
    resolved = "closed"


class RefundCase(Base):
    __tablename__ = "refund_cases"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    contract_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True)
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True)
    mzk_manager_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    applicant_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    provided_services: Mapped[list] = mapped_column(JSON, default=list)
    outstanding_obligations: Mapped[list] = mapped_column(JSON, default=list)
    specialist_explanations: Mapped[str | None] = mapped_column(Text, nullable=True)
    correspondence: Mapped[str | None] = mapped_column(Text, nullable=True)
    calculation: Mapped[str | None] = mapped_column(Text, nullable=True)
    level_criteria: Mapped[dict] = mapped_column(JSON, default=dict)
    level: Mapped[RefundLevel | None] = mapped_column(SAEnum(RefundLevel, name="refund_level"), nullable=True)
    # Сумма фиксируется вместе с утверждением уровня. Раньше её считали на лету
    # при сериализации, поэтому правка ставки переписывала выплаты по всем
    # закрытым кейсам. Nullable: до утверждения уровня суммы ещё нет.
    bonus_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    level_approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    level_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[RefundCaseStatus] = mapped_column(
        SAEnum(RefundCaseStatus, name="refund_case_status"), default=RefundCaseStatus.draft
    )
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision: Mapped[str | None] = mapped_column(Text, nullable=True)
    approval_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    execution_confirmation: Mapped[str | None] = mapped_column(Text, nullable=True)
    bonus_paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    mzk_manager: Mapped["User"] = relationship(foreign_keys=[mzk_manager_id])
