from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class IntakeAiCheck(Base):
    """Cached AI verdict on whether a package-vs-case mismatch in the intake
    reconciliation table ("Сверка анкет") is a genuine discrepancy or just a
    different representation of the same value (e.g. a name written in
    Cyrillic vs its Latin transliteration). Keyed by a hash of the exact
    values compared, so it's naturally invalidated whenever either form
    changes — never reused across a different pair of values."""

    __tablename__ = "intake_ai_checks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field: Mapped[str] = mapped_column(String(100), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    same_meaning: Mapped[bool] = mapped_column(Boolean, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_intake_ai_checks_lookup", "student_id", "field", "content_hash", unique=True),
    )
