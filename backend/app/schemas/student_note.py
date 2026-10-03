from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.models.student_note import StudentNoteStatus


class StudentNoteCreate(BaseModel):
    student_id: uuid.UUID | None = None
    title: str
    source_text: str
    summary_markdown: str | None = None
    student_summary_markdown: str | None = None
    suggested_changes: dict[str, Any] | None = None
    is_important: bool = False
    source_kind: Literal["manual", "meeting", "telegram"] = "manual"


class StudentNoteReviewRequest(BaseModel):
    action: Literal["approve", "reject"]
    summary_markdown: str | None = None
    student_summary_markdown: str | None = None
    suggested_changes: dict[str, Any] | None = None


class StudentNotePublishRequest(BaseModel):
    student_title: str | None = None
    hidden_blocks: list[str] | None = None


class StudentNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID | None = None
    student_name: str | None = None
    title: str
    source_text: str
    summary_markdown: str
    student_summary_markdown: str | None = None
    profile_snapshot: dict[str, Any]
    suggested_changes: dict[str, Any]
    applied_changes: dict[str, Any]
    status: StudentNoteStatus
    created_by: uuid.UUID | None = None
    reviewed_by: uuid.UUID | None = None
    created_at: datetime
    reviewed_at: datetime | None = None
    published_to_student: bool = False
    published_at: datetime | None = None
    student_title: str | None = None
    hidden_blocks: list[str] = []
    blocks: list[dict[str, str]] = []  # toggleable sections: [{key, heading}]
    is_important: bool = False
    source_kind: str = "manual"
    # Как была получена запись встречи (только в GET /notes/{id}): качество
    # текста и можно ли распознать заново. None — конспект не из записи.
    recording: "NoteRecordingInfo | None" = None


class NoteRecordingInfo(BaseModel):
    session_id: uuid.UUID
    capture_mode: str
    quality: str | None = None
    quality_reasons: list[str] = []
    quality_warnings: list[str] = []
    quality_reason_messages: list[str] = []
    quality_warning_messages: list[str] = []
    has_audio: bool = False
    bot_status_reason: str | None = None


StudentNoteResponse.model_rebuild()


class StudentNoteImportanceRequest(BaseModel):
    is_important: bool
