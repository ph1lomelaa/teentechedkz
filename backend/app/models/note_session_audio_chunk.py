from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NoteAudioChunkStatus(str, enum.Enum):
    pending = "pending"
    transcribed = "transcribed"
    failed = "failed"


class NoteSessionAudioChunk(Base):
    """A ~5-minute local recording segment uploaded as a safety net alongside
    the live Deepgram websocket stream — see useAudioBackupRecorder.ts."""

    __tablename__ = "note_session_audio_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("note_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(2048), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[NoteAudioChunkStatus] = mapped_column(
        SAEnum(NoteAudioChunkStatus, name="note_audio_chunk_status"),
        default=NoteAudioChunkStatus.pending,
        nullable=False,
    )
    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    session: Mapped["NoteSession"] = relationship(back_populates="audio_chunks")

    __table_args__ = (
        Index("ix_note_audio_chunks_session_index", "session_id", "chunk_index", unique=True),
    )
