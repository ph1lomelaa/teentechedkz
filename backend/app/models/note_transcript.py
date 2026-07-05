from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NoteTranscript(Base):
    __tablename__ = "note_transcripts"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("note_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    speaker: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_segment_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    session: Mapped["NoteSession"] = relationship(back_populates="transcripts")

    __table_args__ = (
        Index("ix_note_transcripts_session_sequence", "session_id", "sequence_no", unique=True),
        Index("ix_note_transcripts_session_client_segment", "session_id", "client_segment_id", unique=True),
    )
