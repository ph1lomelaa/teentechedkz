import re
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from sqlalchemy import String, DateTime, ForeignKey, Boolean, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class NoteVisibility(str, enum.Enum):
    admin_only = "admin_only"
    admin_and_mzk = "admin_and_mzk"
    all_mentors = "all_mentors"


def note_visible_to_role(visibility: "NoteVisibility", role) -> bool:
    from app.models.user import UserRole

    if role == UserRole.admin:
        return True
    if visibility == NoteVisibility.admin_only:
        return False
    if role == UserRole.mzk_manager:
        return True
    if role == UserRole.mentor:
        return visibility == NoteVisibility.all_mentors
    return False


def default_note_visibility_for(role) -> "NoteVisibility":
    """Visibility tier a system-generated note should get so its creator can
    still see/manage it afterwards. A mentor can only ever see all_mentors
    notes (see note_visible_to_role), so anything hardcoded to admin_and_mzk
    would be invisible to the mentor who triggered its creation."""
    from app.models.user import UserRole

    if role == UserRole.mentor:
        return NoteVisibility.all_mentors
    return NoteVisibility.admin_and_mzk


def _normalize_for_similarity(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"^из (telegram-чата|конспекта)[^:]*:\s*", "", text.lower())).strip()


def is_near_duplicate_note(candidate: str, existing_texts: list[str], *, threshold: float = 0.78) -> bool:
    """Fuzzy check so the same fact re-extracted in slightly different wording
    (e.g. re-running an AI draft over overlapping chat history) doesn't create
    another near-identical ConfidentialNote row every time."""
    norm_candidate = _normalize_for_similarity(candidate)
    if not norm_candidate:
        return False
    for existing in existing_texts:
        norm_existing = _normalize_for_similarity(existing)
        if not norm_existing:
            continue
        if SequenceMatcher(None, norm_candidate, norm_existing).ratio() >= threshold:
            return True
    return False


class ConfidentialNote(Base):
    __tablename__ = "confidential_notes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    # Encrypted with pgcrypto — stored as text (base64)
    note_text_encrypted: Mapped[str | None] = mapped_column("note_text_encrypted", String(8192), nullable=True)
    visible_to_role: Mapped[NoteVisibility] = mapped_column(
        SAEnum(NoteVisibility, name="note_visibility"), default=NoteVisibility.admin_only
    )
    # Published into the student's portal «Заметки» section (read-only for them).
    # Independent of visible_to_role, which governs staff visibility.
    visible_to_student: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="confidential_notes")
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
