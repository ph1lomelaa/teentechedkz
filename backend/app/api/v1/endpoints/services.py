from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.service import Service, ServiceType, ServiceStatus
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole

router = APIRouter(prefix="/services", tags=["services"])


@router.post("")
async def create_service(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    student_id = uuid.UUID(body["student_id"])
    _check_access(current_user, student_id)

    try:
        svc_type = ServiceType(body["service_type"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=422, detail="Неверный service_type")

    try:
        status = ServiceStatus(body.get("status", "not_started"))
    except ValueError:
        status = ServiceStatus.not_started

    svc = Service(
        student_id=student_id,
        contract_id=uuid.UUID(body["contract_id"]) if body.get("contract_id") else None,
        service_type=svc_type,
        included=body.get("included", False),
        status=status,
        result=body.get("result"),
        assigned_mentor_id=uuid.UUID(body["assigned_mentor_id"]) if body.get("assigned_mentor_id") else None,
        notes=body.get("notes"),
        portfolio_directions_count=body.get("portfolio_directions_count"),
        portfolio_directions_types=body.get("portfolio_directions_types"),
        proforientation_specialty=body.get("proforientation_specialty"),
    )
    db.add(svc)
    await db.commit()
    await db.refresh(svc)
    return _svc_to_dict(svc)


@router.patch("/{service_id}")
async def update_service(
    service_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Услуга не найдена")

    _check_access(current_user, svc.student_id)

    for field in ["included", "result", "notes", "portfolio_directions_count", "portfolio_directions_types", "proforientation_specialty"]:
        if field in body:
            setattr(svc, field, body[field])

    if "status" in body:
        try:
            svc.status = ServiceStatus(body["status"])
        except ValueError:
            pass
    if "assigned_mentor_id" in body:
        svc.assigned_mentor_id = uuid.UUID(body["assigned_mentor_id"]) if body["assigned_mentor_id"] else None

    svc.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(svc)
    return _svc_to_dict(svc)


def _check_access(user, student_id: uuid.UUID):
    if user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.lead_mentor, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")


def _svc_to_dict(s: Service) -> dict:
    return {
        "id": str(s.id),
        "student_id": str(s.student_id),
        "contract_id": str(s.contract_id) if s.contract_id else None,
        "service_type": s.service_type.value,
        "included": s.included,
        "status": s.status.value,
        "result": s.result,
        "assigned_mentor_id": str(s.assigned_mentor_id) if s.assigned_mentor_id else None,
        "notes": s.notes,
        "portfolio_directions_count": s.portfolio_directions_count,
        "portfolio_directions_types": s.portfolio_directions_types,
        "proforientation_specialty": s.proforientation_specialty,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }
