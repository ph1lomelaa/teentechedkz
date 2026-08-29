from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.security_incident import SecurityIncident, SecurityIncidentKind, SecurityIncidentStatus
from app.models.user import User, UserRole
from app.services.notify import notify, push_notification

router = APIRouter(prefix="/security-incidents", tags=["security-incidents"])


def _item(row: SecurityIncident) -> dict:
    return {
        "id": str(row.id),
        "kind": row.kind.value,
        "status": row.status.value,
        "title": row.title,
        "description": row.description,
        "evidence": row.evidence,
        "remediation": row.remediation,
        "owner_id": str(row.owner_id) if row.owner_id else None,
        "created_by": str(row.created_by),
        "resolved_by": str(row.resolved_by) if row.resolved_by else None,
        "resolved_at": row.resolved_at.isoformat() if row.resolved_at else None,
        "closed_at": row.closed_at.isoformat() if row.closed_at else None,
        "created_at": row.created_at.isoformat(),
    }


async def _notify_recipients(db: AsyncSession, row: SecurityIncident, *, title: str, body: str) -> list:
    result = await db.execute(
        select(User.id).where(
            (User.role.in_((UserRole.admin, UserRole.mzk_manager)))
            | (User.id == row.owner_id)
        )
    )
    notes = []
    for user_id in {user_id for (user_id,) in result.all()}:
        note = notify(
            db,
            user_id,
            kind="security_incident",
            title=title,
            body=body,
            link=f"/workspace/security-incidents/{row.id}",
            priority="high",
        )
        notes.append(note)
    return notes


@router.get("")
async def list_incidents(db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser, status: str | None = None):
    require_access(current_user, "security_incidents", Action.manage)
    query = select(SecurityIncident).order_by(SecurityIncident.created_at.desc())
    if status:
        try:
            query = query.where(SecurityIncident.status == SecurityIncidentStatus(status))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Неверный статус") from exc
    result = await db.execute(query)
    return {"items": [_item(row) for row in result.scalars().all()]}


@router.post("", status_code=201)
async def create_incident(body: dict, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    require_access(current_user, "security_incidents", Action.manage)
    try:
        kind = SecurityIncidentKind(body["kind"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="Неверный тип инцидента") from exc
    title = str(body.get("title") or "").strip()
    description = str(body.get("description") or "").strip()
    if not title or not description:
        raise HTTPException(status_code=422, detail="Нужны заголовок и описание")
    try:
        owner_id = uuid.UUID(body["owner_id"]) if body.get("owner_id") else current_user.id
    except (ValueError, AttributeError) as exc:
        raise HTTPException(status_code=422, detail="Неверный owner_id") from exc
    row = SecurityIncident(
        kind=kind, title=title, description=description,
        evidence=body.get("evidence"), owner_id=owner_id, created_by=current_user.id,
    )
    db.add(row)
    await db.flush()
    await log_change(db, "security_incident", row.id, "created", None, row.kind.value, str(current_user.id))
    notes = await _notify_recipients(
        db,
        row,
        title="Зарегистрирован инцидент безопасности",
        body=f"{row.title} [incident:{row.id}]",
    )
    await db.commit()
    for note in notes:
        await push_notification(note)
    return _item(row)


@router.patch("/{incident_id}")
async def update_incident(incident_id: uuid.UUID, body: dict, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    require_access(current_user, "security_incidents", Action.manage)
    row = await db.get(SecurityIncident, incident_id)
    if not row:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    if "status" in body:
        try:
            next_status = SecurityIncidentStatus(body["status"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Неверный статус") from exc
        if next_status == SecurityIncidentStatus.closed and not row.resolved_at:
            raise HTTPException(status_code=409, detail="Сначала подтвердите устранение инцидента")
        if next_status in (SecurityIncidentStatus.resolved, SecurityIncidentStatus.closed) and not (
            str(body.get("remediation") or row.remediation or "").strip()
        ):
            raise HTTPException(status_code=422, detail="Меры устранения обязательны")
        row.status = next_status
        if next_status == SecurityIncidentStatus.resolved:
            row.resolved_by = current_user.id
            row.resolved_at = datetime.now(timezone.utc)
        if next_status == SecurityIncidentStatus.closed:
            row.closed_at = datetime.now(timezone.utc)
    if "evidence" in body:
        row.evidence = body["evidence"]
    if "remediation" in body:
        remediation = str(body["remediation"] or "").strip()
        if row.status in (SecurityIncidentStatus.resolved, SecurityIncidentStatus.closed) and not remediation:
            raise HTTPException(status_code=422, detail="Меры устранения обязательны")
        row.remediation = remediation
    await log_change(db, "security_incident", row.id, "updated", None, row.status.value, str(current_user.id))
    notes = await _notify_recipients(
        db,
        row,
        title="Обновлён инцидент безопасности",
        body=f"{row.title}: статус {row.status.value} [incident:{row.id}]",
    )
    await db.commit()
    for note in notes:
        await push_notification(note)
    return _item(row)
