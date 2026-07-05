from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict

from app.models.application import SubmissionStatus, VisaStatus


class ApplicationCreate(BaseModel):
    """Payload for creating a university application for a student."""

    student_id: uuid.UUID
    contract_id: uuid.UUID | None = None
    country: str
    university: str | None = None
    program: str | None = None
    submissions_planned: int = 1
    submission_status: SubmissionStatus = SubmissionStatus.not_started
    visa_status: VisaStatus | None = None
    scholarship_target: bool = False
    is_primary: bool = False
    lead_mentor_id: uuid.UUID | None = None


class ApplicationUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing application."""

    contract_id: uuid.UUID | None = None
    country: str | None = None
    university: str | None = None
    program: str | None = None
    submissions_planned: int | None = None
    submissions_done: int | None = None
    submission_status: SubmissionStatus | None = None
    visa_status: VisaStatus | None = None
    scholarship_target: bool | None = None
    is_primary: bool | None = None
    lead_mentor_id: uuid.UUID | None = None


class ApplicationResponse(BaseModel):
    """Full application data including the resolved lead mentor name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    contract_id: uuid.UUID | None = None
    country: str
    university: str | None = None
    program: str | None = None
    submissions_planned: int
    submissions_done: int
    submission_status: SubmissionStatus
    visa_status: VisaStatus | None = None
    scholarship_target: bool
    is_primary: bool
    lead_mentor_id: uuid.UUID | None = None
    lead_mentor_name: str | None = None  # resolved from join / eager-loaded relation
