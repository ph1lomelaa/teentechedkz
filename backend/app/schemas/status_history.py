from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class StatusHistoryResponse(BaseModel):
    """A single status-change audit record."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    field_changed: str
    old_value: str | None = None
    new_value: str | None = None
    changed_by: str
    source: str | None = None
    changed_at: datetime


class PaginatedHistory(BaseModel):
    """Paginated list of status history records."""

    model_config = ConfigDict(from_attributes=True)

    items: list[StatusHistoryResponse]
    total: int
    page: int
    size: int
    pages: int
