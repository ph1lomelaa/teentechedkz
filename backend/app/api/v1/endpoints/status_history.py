from __future__ import annotations
import uuid
import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.status_history import StatusHistory
from app.models.user import UserRole

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
async def get_history(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    entity_type: str | None = None,
    entity_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
):
    require_access(current_user, "status_history", Action.view)

    query = select(StatusHistory).order_by(StatusHistory.changed_at.desc())
    if entity_type:
        query = query.where(StatusHistory.entity_type == entity_type)
    if entity_id:
        query = query.where(StatusHistory.entity_id == entity_id)

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.offset((page - 1) * size).limit(size)
    result = await db.execute(query)
    items = result.scalars().all()

    return {
        "items": [
            {
                "id": str(h.id),
                "entity_type": h.entity_type,
                "entity_id": str(h.entity_id),
                "field_changed": h.field_changed,
                "old_value": h.old_value,
                "new_value": h.new_value,
                "changed_by": h.changed_by,
                "source": h.source,
                "changed_at": h.changed_at.isoformat(),
            }
            for h in items
        ],
        "total": total,
        "page": page,
        "size": size,
        "pages": math.ceil(total / size) if total else 0,
    }
