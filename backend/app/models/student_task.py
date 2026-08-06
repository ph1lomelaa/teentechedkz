import uuid
from datetime import date, datetime, timezone
from sqlalchemy import Date, Text, DateTime, ForeignKey, Enum as SAEnum, String, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class TaskStatus(str, enum.Enum):
    open = "open"
    awaiting_signature = "awaiting_signature"
    in_progress = "in_progress"
    submitted = "submitted"
    needs_revision = "needs_revision"
    accepted = "accepted"
    blocked_by_agreement = "blocked_by_agreement"
    overdue = "overdue"
    cancelled = "cancelled"
    done = "done"


class StudentTask(Base):
    __tablename__ = "student_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"), nullable=True, index=True)
    task_text: Mapped[str] = mapped_column(Text)
    expected_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    required_documents: Mapped[list | None] = mapped_column(JSON, nullable=True)
    result_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_documents: Mapped[list | None] = mapped_column(JSON, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), default="normal", server_default="normal")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus, name="task_status"), default=TaskStatus.open)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    original_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date_set_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    student: Mapped["Student"] = relationship(back_populates="student_tasks")
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assignee_id])
