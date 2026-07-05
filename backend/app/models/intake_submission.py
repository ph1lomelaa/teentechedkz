import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, Float, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class IntakeSource(str, enum.Enum):
    package = "package"  # «Пакет сопровождения» — заполняет менеджер
    cases = "cases"      # «Кейсы студентов» — заполняет студент


class IntakeStatus(str, enum.Enum):
    new = "new"          # ждёт ручного решения
    linked = "linked"    # привязана к студенту
    ignored = "ignored"


class IntakeSubmission(Base):
    """Строка ответа Google-формы, затянутая синком. Staging до ручной привязки."""

    __tablename__ = "intake_submissions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source: Mapped[IntakeSource] = mapped_column(SAEnum(IntakeSource, name="intake_source"))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # sha256(source|timestamp|ФИО) — защита от дублей при повторных синках
    row_fingerprint: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    raw_data: Mapped[dict] = mapped_column(JSONB)

    full_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone_normalized: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    manager_name: Mapped[str | None] = mapped_column(String(200), nullable=True)

    suggested_student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True
    )
    suggested_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[IntakeStatus] = mapped_column(
        SAEnum(IntakeStatus, name="intake_status"), default=IntakeStatus.new
    )
    linked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student | None"] = relationship(foreign_keys=[student_id])
    suggested_student: Mapped["Student | None"] = relationship(foreign_keys=[suggested_student_id])
