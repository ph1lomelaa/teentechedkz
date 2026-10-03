from __future__ import annotations

import uuid
from datetime import datetime
from urllib.parse import urlsplit

from pydantic import AwareDatetime, BaseModel, ConfigDict, field_validator

from app.models.meeting import MeetingStatus, MeetingType

_cfg = ConfigDict(from_attributes=True, use_enum_values=True)


def normalize_meeting_link(value: str | None) -> str | None:
    """Пустая строка или рабочая http(s)-ссылка.

    «zoom.us/j/1» без схемы дополняется до https. Мусор вроде «ss» отклоняется:
    браузер открыл бы его как путь внутри самой системы, а не встречу.
    """
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        parts = urlsplit(raw)
        host = parts.hostname or ""
    except ValueError:
        raise ValueError("Укажите ссылку на встречу: https://…") from None
    if parts.scheme not in ("http", "https") or "." not in host or " " in raw:
        raise ValueError("Укажите ссылку на встречу: https://…")
    return raw


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
    # Время без пояса толкуется неоднозначно и роняло напоминания (сравнение
    # naive с aware) — требуем пояс, клиенты и так шлют toISOString().
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    meeting_link: str = ""
    mentor_id: uuid.UUID | None = None

    @field_validator("meeting_link")
    @classmethod
    def _check_link(cls, v: str) -> str:
        return normalize_meeting_link(v) or ""


class MeetingUpdate(BaseModel):
    title: str | None = None
    service_id: uuid.UUID | None = None
    meeting_type: MeetingType | None = None
    description: str | None = None
    outcome: str | None = None
    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    meeting_link: str | None = None
    recording_url: str | None = None
    transcript_url: str | None = None
    status: MeetingStatus | None = None

    @field_validator("meeting_link")
    @classmethod
    def _check_link(cls, v: str | None) -> str | None:
        return normalize_meeting_link(v)
