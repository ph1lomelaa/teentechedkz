import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StudentNoteStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    rejected = "rejected"


class StudentNote(Base):
    __tablename__ = "student_notes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("services.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    profile_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    suggested_changes: Mapped[dict] = mapped_column(JSON, default=dict)
    applied_changes: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[StudentNoteStatus] = mapped_column(
        SAEnum(StudentNoteStatus, name="student_note_status"),
        default=StudentNoteStatus.draft,
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Publication to the student portal (Приоритет 3). A note is only visible to
    # the student once a manager explicitly publishes it; `student_title` is the
    # personal heading shown instead of the internal title, and `hidden_blocks`
    # lists section keys the manager chose to keep out of the student view.
    published_to_student: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    student_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    hidden_blocks: Mapped[list] = mapped_column(JSON, default=list)
    # Separate reformulation of summary_markdown written for the student's own
    # voice/tone (no CRM jargon) — NULL for notes created before this field
    # existed, in which case the portal falls back to the mentor text.
    student_summary_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_important: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source_kind: Mapped[str] = mapped_column(String(30), default="manual", nullable=False)

    student: Mapped["Student | None"] = relationship(back_populates="notes")
