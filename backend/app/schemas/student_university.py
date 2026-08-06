from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.university import UniversityOut

_cfg = ConfigDict(from_attributes=True)


class ShortlistItemOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    student_id: uuid.UUID
    university_id: uuid.UUID
    note: str = ""
    priority: int | None = None
    added_by_user_id: uuid.UUID | None = None
    added_by_role: str = ""
    added_by_name: str | None = None
    created_at: datetime
    # The nested university is what every surface renders (photo, flag, degrees).
    # UniversityOut is the lean list payload, so this stays cheap — the
    # alternative is each caller fetching the whole 200-row catalog to join.
    university: UniversityOut


class ShortlistCreate(BaseModel):
    university_id: uuid.UUID
    # Ignored for students (forced to self), required from staff — same shape
    # as CredentialCreate.
    student_id: uuid.UUID | None = None
    note: str = ""
    priority: int | None = None


class ShortlistUpdate(BaseModel):
    note: str | None = None
    priority: int | None = None
