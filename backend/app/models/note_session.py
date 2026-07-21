from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NoteSessionStatus(str, enum.Enum):
    active = "active"
    completed = "completed"
    cancelled = "cancelled"


class NoteSession(Base):
    __tablename__ = "note_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    note_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("student_notes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    meeting_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("meetings.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        unique=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False, default="deepgram")
    status: Mapped[NoteSessionStatus] = mapped_column(
        SAEnum(NoteSessionStatus, name="note_session_status"),
        default=NoteSessionStatus.active,
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    backup_transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    student: Mapped["Student | None"] = relationship(back_populates="note_sessions")
    note: Mapped["StudentNote | None"] = relationship(foreign_keys=[note_id])
    meeting: Mapped["Meeting | None"] = relationship(
        back_populates="note_session",
        foreign_keys=[meeting_id],
    )
    transcripts: Mapped[list["NoteTranscript"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="NoteTranscript.sequence_no",
    )
    audio_chunks: Mapped[list["NoteSessionAudioChunk"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="NoteSessionAudioChunk.chunk_index",
    )
