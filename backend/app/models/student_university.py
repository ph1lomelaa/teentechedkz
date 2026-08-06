import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StudentUniversity(Base):
    """A university on a student's shortlist — "куда смотрим", before any
    application exists.

    Deliberately separate from `Application`: the shortlist is a wishlist that
    the student and their mentor build together, while an Application tracks
    the submission process. Giving this table a status field would duplicate
    Application's and let the two drift.

    Both the student and their staff (admin / mzk_manager / assigned mentor)
    may add entries — `added_by_role` records which, so the UI can show
    "выбор студента" vs "предложил ментор".
    """

    __tablename__ = "student_universities"
    __table_args__ = (
        # Student and mentor will both reach for the same obvious university;
        # the POST handler turns the violation into a friendly 409.
        UniqueConstraint("student_id", "university_id", name="uq_student_university"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    # CASCADE (not SET NULL as in university_credentials): a credential without
    # its university still holds a usable login, but a shortlist row pointing
    # at nothing is garbage every UI would have to filter out.
    university_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("universities.id", ondelete="CASCADE"), index=True
    )
    # SET NULL: deactivating a staff member must not delete a student's list.
    added_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Denormalised on purpose: once added_by_user_id goes NULL the UI can still
    # say who suggested it, and listing needs no join just to render a badge.
    added_by_role: Mapped[str] = mapped_column(String(20), default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Nullable rather than defaulted, so "не расставлен" stays distinguishable
    # from "первый по приоритету". Sorted NULLS LAST.
    priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    university = relationship("University", lazy="joined")
    added_by = relationship("User", lazy="joined")
