"""Utility to write audit records to status_history."""
from datetime import datetime, timezone
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.status_history import StatusHistory


async def log_change(
    db: AsyncSession,
    entity_type: str,
    entity_id: uuid.UUID,
    field_changed: str,
    old_value: str | None,
    new_value: str | None,
    changed_by: str,
    source: str | None = "manual",
) -> None:
    record = StatusHistory(
        entity_type=entity_type,
        entity_id=entity_id,
        field_changed=field_changed,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
        changed_by=changed_by,
        source=source,
        changed_at=datetime.now(timezone.utc),
    )
    db.add(record)
