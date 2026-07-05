from __future__ import annotations

import uuid
from datetime import datetime, date

from pydantic import BaseModel, ConfigDict

from app.models.communication_log import CommSource, MessageType


class CommunicationLogCreate(BaseModel):
    """Payload for recording a communication event for a student."""

    student_id: uuid.UUID
    source: CommSource
    message_type: MessageType
    raw_text: str | None = None
    ai_summary: str | None = None
    zoom_call_date: date | None = None
    zoom_duration_min: int | None = None


class CommunicationLogResponse(BaseModel):
    """Full communication log entry."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    source: CommSource
    message_type: MessageType
    raw_text: str | None = None
    ai_summary: str | None = None
    zoom_call_date: date | None = None
    zoom_duration_min: int | None = None
    created_at: datetime
