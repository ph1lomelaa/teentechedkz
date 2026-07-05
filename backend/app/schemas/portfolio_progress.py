from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.portfolio_progress import PortfolioStatus, FocusArea


class PortfolioProgressCreate(BaseModel):
    """Payload for creating a portfolio progress record for a student."""

    student_id: uuid.UUID
    vpp_group: str | None = None
    first_call_milestone: str | None = None
    deadline_text: str | None = None
    focus_areas: list[FocusArea] = []
    status: PortfolioStatus = PortfolioStatus.not_started
    achievements_count: int = 0
    calls_count: int = 0
    special_notes: str | None = None


class PortfolioProgressUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing portfolio progress record."""

    vpp_group: str | None = None
    first_call_milestone: str | None = None
    deadline_text: str | None = None
    focus_areas: list[FocusArea] | None = None
    status: PortfolioStatus | None = None
    achievements_count: int | None = None
    calls_count: int | None = None
    special_notes: str | None = None


class PortfolioProgressResponse(BaseModel):
    """Full portfolio progress record."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    vpp_group: str | None = None
    first_call_milestone: str | None = None
    deadline_text: str | None = None
    focus_areas: list[str] = []
    status: PortfolioStatus
    achievements_count: int
    calls_count: int
    special_notes: str | None = None
    updated_at: datetime
