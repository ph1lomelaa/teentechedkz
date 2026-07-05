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
    suggested_changes: dict[str, Any] | None = None


class StudentNoteReviewRequest(BaseModel):
    action: Literal["approve", "reject"]


class StudentNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
