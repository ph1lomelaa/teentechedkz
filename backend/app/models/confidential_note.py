import uuid
from datetime import datetime, timezone
from sqlalchemy import String, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class NoteVisibility(str, enum.Enum):
    admin_only = "admin_only"
    admin_and_mzk = "admin_and_mzk"
    all_mentors = "all_mentors"


class ConfidentialNote(Base):
    __tablename__ = "confidential_notes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    # Encrypted with pgcrypto — stored as text (base64)
    note_text_encrypted: Mapped[str | None] = mapped_column("note_text_encrypted", String(8192), nullable=True)
    visible_to_role: Mapped[NoteVisibility] = mapped_column(
        SAEnum(NoteVisibility, name="note_visibility"), default=NoteVisibility.admin_only
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="confidential_notes")
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
