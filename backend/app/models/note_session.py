from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NoteSessionStatus(str, enum.Enum):
    draft = "draft"  # создана, звук ещё не пошёл; в списках не показывается
    active = "active"
    completed = "completed"
    cancelled = "cancelled"
    interrupted = "interrupted"  # запись оборвалась, но текст или аудио есть
    failed = "failed"  # записать не удалось


# Языки распознавания, которые предлагаем ментору. Deepgram `multi` не
# покрывает казахский, поэтому язык выбирается явно.
NOTE_SESSION_LANGUAGES = ("ru", "kk", "en")
NOTE_SESSION_CAPTURE_MODES = ("browser", "bot", "upload")


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
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="ru", server_default="ru")
    capture_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, default="browser", server_default="browser"
    )
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

    # --- Запись ботом (capture_mode == "bot"), см. services/meeting_bot ---
    meeting_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    bot_provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    bot_external_id: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)
    # scheduled | joining | waiting_room | waiting_for_mentor | recording | ended | processing | done | failed
    bot_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Код причины (sub_type провайдера или наш), текст для ментора — в reasons.py
    bot_status_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bot_last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    bot_joined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Звук встречи (mp3), скопированный из провайдера в MinIO — для повторного распознавания
    audio_storage_path: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    # --- Проверка качества текста перед конспектом, см. meeting_bot/quality.py ---
    quality: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ok | incomplete
    quality_reasons: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    quality_warnings: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    quality_metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
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
