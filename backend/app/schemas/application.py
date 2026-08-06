from __future__ import annotations

import datetime
import uuid

from pydantic import BaseModel, ConfigDict

from app.models.application import SubmissionStatus, VisaStatus
from app.schemas.university import UniversityOut


class ApplicationCreate(BaseModel):
    """Payload for creating a university application for a student."""

    student_id: uuid.UUID
    contract_id: uuid.UUID | None = None
    country: str
    university: str | None = None
    # Необязательная привязка к справочнику. Свободный текст остаётся: вуза
    # может не быть в каталоге, и заставлять ментора ждать импорта нельзя.
    university_id: uuid.UUID | None = None
    program: str | None = None
    # Дедлайн этой подачи; пусто — UI покажет справочный из вуза или страны.
    deadline: datetime.date | None = None
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
    university_id: uuid.UUID | None = None
    program: str | None = None
    deadline: datetime.date | None = None
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
    deadline: datetime.date | None = None
    submissions_planned: int
    submissions_done: int
    submission_status: SubmissionStatus
    visa_status: VisaStatus | None = None
    scholarship_target: bool
    is_primary: bool
    lead_mentor_id: uuid.UUID | None = None
    lead_mentor_name: str | None = None  # resolved from join / eager-loaded relation


class StudentApplicationOut(BaseModel):
    """Заявка глазами самого студента.

    Сознательно без contract_id и lead_mentor_id: договор — внутренняя учётная
    сущность, а ведущий ментор для студента ничего не значит (он и так знает
    своего ментора). Всё остальное — про его собственное поступление, и
    скрывать это от него незачем.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    country: str
    university: str | None = None
    program: str | None = None
    deadline: datetime.date | None = None
    submissions_planned: int
    submissions_done: int
    submission_status: SubmissionStatus
    visa_status: VisaStatus | None = None
    scholarship_target: bool
    is_primary: bool
    # Присутствует, только если заявка привязана к справочнику — тогда портал
    # рисует фото, флаг и ссылку на страницу вуза.
    university_ref: UniversityOut | None = None
