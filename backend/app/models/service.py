import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, Integer, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class ServiceType(str, enum.Enum):
    proforientation = "proforientation"
    ielts_mock = "ielts_mock"
    ielts_prep = "ielts_prep"
    sat_prep = "sat_prep"
    portfolio_improvement = "portfolio_improvement"
    english_general = "english_general"


class ServiceStatus(str, enum.Enum):
    not_started = "not_started"
    scheduled = "scheduled"
    in_progress = "in_progress"
    completed = "completed"
    failed = "failed"
    not_applicable = "not_applicable"


class Service(Base):
    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    contract_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contracts.id"), nullable=True)
    service_type: Mapped[ServiceType] = mapped_column(SAEnum(ServiceType, name="service_type"))
    included: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[ServiceStatus] = mapped_column(
        SAEnum(ServiceStatus, name="service_status"), default=ServiceStatus.not_started
    )
    result: Mapped[str | None] = mapped_column(String(500), nullable=True)
    assigned_mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    portfolio_directions_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    portfolio_directions_types: Mapped[str | None] = mapped_column(Text, nullable=True)
    proforientation_specialty: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    student: Mapped["Student"] = relationship(back_populates="services")
    contract: Mapped["Contract | None"] = relationship(back_populates="services", foreign_keys=[contract_id])
    assigned_mentor: Mapped["User | None"] = relationship(foreign_keys=[assigned_mentor_id])
