from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.meeting import MeetingStatus, MeetingType

_cfg = ConfigDict(from_attributes=True, use_enum_values=True)


class MeetingOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    student_id: uuid.UUID
    service_id: uuid.UUID | None = None
    mentor_id: uuid.UUID | None = None
    title: str
    meeting_type: str = MeetingType.regular.value
    description: str
    outcome: str
    starts_at: datetime
    ends_at: datetime
    meeting_link: str
    recording_url: str
    transcript_url: str
    status: str
    note_session_id: uuid.UUID | None = None
    created_at: datetime


class MeetingCreate(BaseModel):
    student_id: uuid.UUID
    service_id: uuid.UUID | None = None
    title: str
    meeting_type: MeetingType = MeetingType.regular
    description: str = ""
    outcome: str = ""
    starts_at: datetime
    ends_at: datetime
    meeting_link: str = ""
    mentor_id: uuid.UUID | None = None


class MeetingUpdate(BaseModel):
    title: str | None = None
    service_id: uuid.UUID | None = None
    meeting_type: MeetingType | None = None
    description: str | None = None
    outcome: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    meeting_link: str | None = None
    recording_url: str | None = None
    transcript_url: str | None = None
    status: MeetingStatus | None = None
