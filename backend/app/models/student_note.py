import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, JSON, Text
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

    student: Mapped["Student | None"] = relationship(back_populates="notes")
