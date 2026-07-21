from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict


class CountryReferenceCreate(BaseModel):
    """Payload for adding a country entry to the reference table."""

    country_name: str
    vpp_required: bool = False
    submission_deadline_notes: str | None = None
    notes: str | None = None
    degree_levels: list[str] = ["undergraduate", "graduate"]


class CountryReferenceUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing country reference."""

    country_name: str | None = None
    vpp_required: bool | None = None
    submission_deadline_notes: str | None = None
    notes: str | None = None
    degree_levels: list[str] | None = None


class CountryReferenceResponse(BaseModel):
    """Full country reference record."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    country_name: str
    vpp_required: bool
    submission_deadline_notes: str | None = None
    notes: str | None = None
    code: str = ""
    flag_emoji: str = ""
    flag_url: str = ""
    degree_levels: list[str] = ["undergraduate", "graduate"]
