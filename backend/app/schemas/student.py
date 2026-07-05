from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict

from app.models.student import DegreeLevel, IntakeSeason

if TYPE_CHECKING:
    from app.schemas.contract import ContractResponse
    from app.schemas.guardian import GuardianResponse
    from app.schemas.confidential_note import ConfidentialNoteResponse
    from app.schemas.application import ApplicationResponse
    from app.schemas.service import ServiceResponse
    from app.schemas.portfolio_progress import PortfolioProgressResponse
    from app.schemas.document import DocumentResponse
    from app.schemas.student_task import StudentTaskResponse
    from app.schemas.communication_log import CommunicationLogResponse
    from app.schemas.student_note import StudentNoteResponse


class StudentCreate(BaseModel):
    """Payload for registering a new student."""

    full_name: str
    phone: str
    city: str | None = None
    age: int | None = None
    degree_level: DegreeLevel
    specialty: str | None = None
    group_direction: str | None = None
    additional_sphere: str | None = None
    gpa: str | None = None
    achievements_text: str | None = None
    budget_per_year: str | None = None
    transcript_resume_url: str | None = None
    intake_year: int
    intake_season: IntakeSeason | None = None


class StudentUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing student."""

    full_name: str | None = None
    phone: str | None = None
    city: str | None = None
    age: int | None = None
    degree_level: DegreeLevel | None = None
    specialty: str | None = None
    group_direction: str | None = None
    additional_sphere: str | None = None
    gpa: str | None = None
    achievements_text: str | None = None
    budget_per_year: str | None = None
    transcript_resume_url: str | None = None
    intake_year: int | None = None
    intake_season: IntakeSeason | None = None


class StudentBase(BaseModel):
    """All student scalar fields; base for richer response schemas."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    phone: str
    city: str | None = None
    age: int | None = None
    degree_level: DegreeLevel
    specialty: str | None = None
    group_direction: str | None = None
    additional_sphere: str | None = None
    gpa: str | None = None
    achievements_text: str | None = None
    budget_per_year: str | None = None
    transcript_resume_url: str | None = None
    intake_year: int
    intake_season: IntakeSeason | None = None
    created_at: datetime
    updated_at: datetime


class StudentListItem(BaseModel):
    """
    Lightweight row used in paginated student tables.

    `days_in_work` is computed at the service layer (not a DB column).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    phone: str
    degree_level: DegreeLevel
    intake_year: int
    city: str | None = None
    days_in_work: int | None = None


class StudentFull(StudentBase):
    """
    Complete student profile for admin / mzk_manager roles.

    Includes contracts, guardians, confidential notes, financial data,
    applications, services, portfolio progress, documents, tasks, and
    communication logs.
    """

    contracts: list[ContractResponse] = []
    guardians: list[GuardianResponse] = []
    confidential_notes: list[ConfidentialNoteResponse] = []
    applications: list[ApplicationResponse] = []
    services: list[ServiceResponse] = []
    portfolio_progress: PortfolioProgressResponse | None = None
    documents: list[DocumentResponse] = []
    student_tasks: list[StudentTaskResponse] = []
    communication_logs: list[CommunicationLogResponse] = []
    notes: list[StudentNoteResponse] = []


class StudentMentor(StudentBase):
    """
    Limited student profile for lead_mentor / mentor roles.

    Contracts, guardians, confidential notes, and payment details are
    intentionally excluded.
    """

    applications: list[ApplicationResponse] = []
    services: list[ServiceResponse] = []
    portfolio_progress: PortfolioProgressResponse | None = None
    documents: list[DocumentResponse] = []
    student_tasks: list[StudentTaskResponse] = []
    communication_logs: list[CommunicationLogResponse] = []


class PaginatedStudents(BaseModel):
    """Paginated list of student list items."""

    model_config = ConfigDict(from_attributes=True)

    items: list[StudentListItem]
    total: int
    page: int
    size: int
    pages: int
