from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.note_session import NoteSessionStatus
from app.models.note_session_audio_chunk import NoteAudioChunkStatus
from app.models.student_note import StudentNoteStatus


class NoteSessionCreate(BaseModel):
    student_id: uuid.UUID | None = None
    meeting_id: uuid.UUID | None = None
    title: str | None = None
    source: str = "deepgram"


class NoteTranscriptCreate(BaseModel):
    text: str
    timestamp: datetime | None = None
    speaker: str | None = None
    client_segment_id: str | None = None


class NoteSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID | None = None
    student_name: str | None = None
    note_id: uuid.UUID | None = None
    meeting_id: uuid.UUID | None = None
    title: str
    source: str
    status: NoteSessionStatus
    started_at: datetime
    ended_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    created_by: uuid.UUID | None = None
    transcript_count: int = 0
    latest_transcript: str | None = None


class NoteTranscriptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    text: str
    timestamp: datetime
    speaker: str | None = None
    client_segment_id: str | None = None
    sequence_no: int
    created_at: datetime


class NoteSessionNoteSummary(BaseModel):
    id: uuid.UUID
    student_id: uuid.UUID | None = None
    student_name: str | None = None
    title: str
    source_text: str
    summary_markdown: str
    profile_snapshot: dict[str, Any]
    suggested_changes: dict[str, Any]
    applied_changes: dict[str, Any]
    status: StudentNoteStatus
    created_by: uuid.UUID | None = None
    reviewed_by: uuid.UUID | None = None
    created_at: datetime
    reviewed_at: datetime | None = None


class NoteSessionDetail(NoteSessionResponse):
    transcripts: list[NoteTranscriptResponse] = Field(default_factory=list)
    note: NoteSessionNoteSummary | None = None


class NoteSessionDraftResponse(BaseModel):
    title: str
    source_text: str
    summary_markdown: str
    profile_snapshot: dict[str, Any]
    suggested_changes: dict[str, Any]
    change_preview: list[dict[str, Any]]
    # "provider_chain" when a real AI model produced the draft, "heuristic" when
    # it fell back to rule-based generation (no key / provider error). Lets the
    # UI flag a non-AI draft instead of it looking like a poor AI result.
    ai_model: str | None = None


class NoteSessionFinalizeResponse(BaseModel):
    session: NoteSessionResponse
    note: NoteSessionNoteSummary


class NoteSessionAudioChunkResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    chunk_index: int
    file_size: int
    status: NoteAudioChunkStatus
    transcript_text: str | None = None
    download_url: str | None = None
    created_at: datetime


class NoteSessionReconcileResponse(BaseModel):
    backup_transcript_text: str
    chunks: list[NoteSessionAudioChunkResponse]
