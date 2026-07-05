from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.sync_status import SyncSource, SyncStatusEnum


class SyncStatusResponse(BaseModel):
    """Current sync state for a given data source (optionally scoped to a student)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source: SyncSource
    student_id: uuid.UUID | None = None
    last_synced_at: datetime
    status: SyncStatusEnum
    note: str | None = None
