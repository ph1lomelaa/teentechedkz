from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.student_task import TaskStatus


class StudentTaskCreate(BaseModel):
    """Payload for creating a task linked to a student."""

    student_id: uuid.UUID
    service_id: uuid.UUID | None = None
    task_text: str


class StudentTaskUpdate(BaseModel):
    """Partial update for an existing student task."""

    status: TaskStatus | None = None
    task_text: str | None = None
    service_id: uuid.UUID | None = None


class StudentTaskDueDateSet(BaseModel):
    """Payload for assigning/changing a task's due date. Admin-only (§2.2 ОС 30/07)."""

    due_date: date | None = None


class StudentTaskResponse(BaseModel):
    """Full task record including the resolved creator name."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    student_id: uuid.UUID
    service_id: uuid.UUID | None = None
    task_text: str
    status: TaskStatus
    created_by: uuid.UUID
    created_by_name: str | None = None  # resolved from join / eager-loaded relation
    created_at: datetime
    done_at: datetime | None = None
    due_date: date | None = None
    due_date_set_by: uuid.UUID | None = None
    urgency: str | None = None  # resolved via app.services.task_urgency, not a DB column
