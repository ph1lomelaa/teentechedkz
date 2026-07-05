import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class InsightType(str, enum.Enum):
    call_summary = "call_summary"
    status_update = "status_update"
    contact_change = "contact_change"
    payment_event = "payment_event"
    service_result = "service_result"
    document_flag = "document_flag"


class RiskLevel(str, enum.Enum):
    low = "low"
    sensitive = "sensitive"


class InsightStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class PendingInsight(Base):
    __tablename__ = "pending_insights"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    communication_log_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("communication_log.id"), nullable=True
    )
    source_telegram_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("telegram_messages.id"), nullable=True
    )
    insight_type: Mapped[InsightType] = mapped_column(SAEnum(InsightType, name="insight_type"))
    proposed_changes: Mapped[dict] = mapped_column(JSONB, default=dict)
    unmatched_fields: Mapped[dict] = mapped_column(JSONB, default=dict)
    confidence: Mapped[float] = mapped_column(Numeric(4, 3), default=0.0)
    risk_level: Mapped[RiskLevel] = mapped_column(SAEnum(RiskLevel, name="risk_level"), default=RiskLevel.low)
    status: Mapped[InsightStatus] = mapped_column(
        SAEnum(InsightStatus, name="insight_status"), default=InsightStatus.pending
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    auto_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["Student"] = relationship(back_populates="pending_insights")
    communication_log: Mapped["CommunicationLog | None"] = relationship(back_populates="pending_insights")
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
