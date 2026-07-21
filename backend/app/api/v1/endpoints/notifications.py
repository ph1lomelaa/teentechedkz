"""Notification endpoints for students."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.user import User
from app.models.notification import Notification
from app.services.ws_hub import manager

router = APIRouter(tags=["notifications"], prefix="/notifications")


class NotificationResponse(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    link: str
    is_read: bool
    priority: str
    created_at: str

    class Config:
        from_attributes = True


class BulkReadBody(BaseModel):
    notification_ids: list[str]


def _to_dict(n: Notification) -> NotificationResponse:
    return NotificationResponse(
        id=str(n.id),
        kind=n.kind,
        title=n.title,
        body=n.body,
        link=n.link,
        is_read=n.is_read,
        priority=n.priority,
        created_at=n.created_at.isoformat(),
    )


@router.get("")
async def list_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(CurrentUser)],
    unread_only: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Get user notifications."""
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.is_read == False)
    query = query.order_by(desc(Notification.created_at)).limit(limit).offset(offset)

    result = await db.execute(query)
    notifications = result.scalars().all()

    # Total count respecting the unread_only filter
    count_query = select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
    if unread_only:
        count_query = count_query.where(Notification.is_read == False)
    total = (await db.execute(count_query)).scalar_one()

    # Global unread count (not scoped to the current page)
    unread_result = await db.execute(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == user.id, Notification.is_read == False)
    )
    unread_count = unread_result.scalar_one()

    return {
        "data": [_to_dict(n) for n in notifications],
        "total": total,
        "unread_count": unread_count,
    }


@router.post("/{notification_id}/read")
async def mark_as_read(
    notification_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(CurrentUser)],
):
    """Mark notification as read."""
    try:
        notif_uuid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    notification = await db.get(Notification, notif_uuid)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.user_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    notification.is_read = True
    await db.commit()

    return {"status": "ok"}


@router.post("/bulk/read")
async def bulk_mark_as_read(
    body: BulkReadBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(CurrentUser)],
):
    """Mark multiple notifications as read."""
    try:
        ids = [uuid.UUID(nid) for nid in body.notification_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    result = await db.execute(
        select(Notification).where(
            Notification.id.in_(ids),
            Notification.user_id == user.id,
        )
    )
    notifications = result.scalars().all()

    for n in notifications:
        n.is_read = True

    await db.commit()
    return {"marked_count": len(notifications)}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(CurrentUser)],
):
    """Delete a notification."""
    try:
        notif_uuid = uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    notification = await db.get(Notification, notif_uuid)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    if notification.user_id != user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(notification)
    await db.commit()

    return {"status": "ok"}
