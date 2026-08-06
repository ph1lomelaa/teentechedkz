"""Экстренные контакты студента (регламент МЗК п.3.2, п.3.4)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.emergency_contact import EmergencyContact
from app.models.user import UserRole

router = APIRouter(prefix="/emergency-contacts", tags=["emergency_contacts"])


def _require_staff(user):
    if user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")


def _to_dict(c: EmergencyContact) -> dict:
    return {
        "id": str(c.id),
        "student_id": str(c.student_id),
        "full_name": c.full_name,
        "relation": c.relation,
        "phone": c.phone,
        "created_at": c.created_at.isoformat(),
    }


@router.get("/student/{student_id}")
async def list_emergency_contacts(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_staff(current_user)
    result = await db.execute(
        select(EmergencyContact).where(EmergencyContact.student_id == student_id)
    )
    return [_to_dict(c) for c in result.scalars().all()]


@router.post("/student/{student_id}")
async def create_emergency_contact(
    student_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_staff(current_user)
    full_name = (body.get("full_name") or "").strip()
    phone = (body.get("phone") or "").strip()
    if not full_name or not phone:
        raise HTTPException(status_code=422, detail="Укажите ФИО и телефон")

    contact = EmergencyContact(
        student_id=student_id,
        full_name=full_name,
        relation=body.get("relation"),
        phone=phone,
        created_at=datetime.now(timezone.utc),
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return _to_dict(contact)


@router.delete("/{contact_id}")
async def delete_emergency_contact(
    contact_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_staff(current_user)
    result = await db.execute(select(EmergencyContact).where(EmergencyContact.id == contact_id))
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Контакт не найден")
    await db.delete(contact)
    await db.commit()
    return {"message": "Deleted"}
