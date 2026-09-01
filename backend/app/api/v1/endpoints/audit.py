"""Read-only view over the security audit log (Этап 0.1).

Состав ролей задаёт реестр (`audit:view`), а не константа в коде: иначе
переключатель в конструкторе прав менял бы матрицу, но не этот эндпоинт.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.audit_log import AuditAction, AuditLog

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
async def list_audit(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    action: AuditAction | None = None,
    target_user_id: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    require_access(current_user, "audit", Action.view)

    conditions = []
    if action is not None:
        conditions.append(AuditLog.action == action)
    if target_user_id is not None:
        conditions.append(AuditLog.target_user_id == target_user_id)

    total_stmt = select(func.count()).select_from(AuditLog)
    rows_stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
    for cond in conditions:
        total_stmt = total_stmt.where(cond)
        rows_stmt = rows_stmt.where(cond)

    total = (await db.execute(total_stmt)).scalar_one()
    rows = (await db.execute(rows_stmt)).scalars().all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(r.id),
                "action": r.action.value,
                "actor_user_id": str(r.actor_user_id) if r.actor_user_id else None,
                "actor_email": r.actor_email,
                "target_user_id": str(r.target_user_id) if r.target_user_id else None,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "ip": r.ip,
                "user_agent": r.user_agent,
                "meta": r.meta,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }
