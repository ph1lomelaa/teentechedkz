from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.service import ServiceType, ServiceStatus


class ServiceCreate(BaseModel):
    """Payload for attaching a service to a student."""

    student_id: uuid.UUID
    contract_id: uuid.UUID | None = None
    service_type: ServiceType
    included: bool = False
    status: ServiceStatus = ServiceStatus.not_started
    result: str | None = None
    assigned_mentor_id: uuid.UUID | None = None
    notes: str | None = None
    portfolio_directions_count: int | None = None
    portfolio_directions_types: str | None = None
    proforientation_specialty: str | None = None


class ServiceUpdate(BaseModel):
    """All fields optional; used for PATCH on an existing service."""

    contract_id: uuid.UUID | None = None
    service_type: ServiceType | None = None
    included: bool | None = None
    status: ServiceStatus | None = None
    result: str | None = None
    assigned_mentor_id: uuid.UUID | None = None
    notes: str | None = None
    portfolio_directions_count: int | None = None
    portfolio_directions_types: str | None = None
    proforientation_specialty: str | None = None


class ServiceResponse(BaseModel):
    """Full service data including the resolved mentor name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    contract_id: uuid.UUID | None = None
    service_type: ServiceType
    included: bool
    status: ServiceStatus
    result: str | None = None
    assigned_mentor_id: uuid.UUID | None = None
    assigned_mentor_name: str | None = None  # resolved from join / eager-loaded relation
    notes: str | None = None
    portfolio_directions_count: int | None = None
    portfolio_directions_types: str | None = None
    proforientation_specialty: str | None = None
    created_at: datetime
    updated_at: datetime
