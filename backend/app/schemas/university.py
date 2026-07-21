from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

_cfg = ConfigDict(from_attributes=True)


class UniversityOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    country_ref_id: uuid.UUID | None = None
    country_name: str | None = None
    country_flag_emoji: str = ""
    country_flag_url: str = ""
    name: str
    city: str
    description: str
    website: str
    world_ranking: int | None = None
    tuition_range: str
    has_grants: bool


class UniversityCreate(BaseModel):
    name: str
    country_name: str | None = None
    country_ref_id: uuid.UUID | None = None
    city: str = ""
    description: str = ""
    website: str = ""
    world_ranking: int | None = None
    tuition_range: str = ""
    has_grants: bool = False


class UniversityUpdate(BaseModel):
    name: str | None = None
    country_name: str | None = None
    country_ref_id: uuid.UUID | None = None
    city: str | None = None
    description: str | None = None
    website: str | None = None
    world_ranking: int | None = None
    tuition_range: str | None = None
    has_grants: bool | None = None


# ---- credentials ----
class CredentialOut(BaseModel):
    """No plaintext password here — reveal via a separate endpoint."""
    model_config = _cfg
    id: uuid.UUID
    student_id: uuid.UUID
    university_id: uuid.UUID | None = None
    portal_name: str
    login: str          # decrypted login (safe to show)
    notes: str
    created_at: datetime
    updated_at: datetime


class CredentialCreate(BaseModel):
    student_id: uuid.UUID | None = None  # ignored in the portal (self), required from CRM
    university_id: uuid.UUID | None = None
    portal_name: str
    login: str
    password: str
    notes: str = ""


class CredentialUpdate(BaseModel):
    university_id: uuid.UUID | None = None
    portal_name: str | None = None
    login: str | None = None
    password: str | None = None
    notes: str | None = None


class CredentialReveal(BaseModel):
    password: str
