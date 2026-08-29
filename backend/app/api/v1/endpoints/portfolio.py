from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.body import required_uuid
from app.models.portfolio_progress import PortfolioProgress, PortfolioStatus
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.post("")
async def create_portfolio(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    student_id = required_uuid(body, "student_id")
    require_access(current_user, "portfolio", Action.manage)

    existing = await db.execute(select(PortfolioProgress).where(PortfolioProgress.student_id == student_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Запись УП уже существует")

    try:
        status = PortfolioStatus(body.get("status", "not_started"))
    except ValueError:
        status = PortfolioStatus.not_started

    pp = PortfolioProgress(
        student_id=student_id,
        vpp_group=body.get("vpp_group"),
        first_call_milestone=body.get("first_call_milestone"),
        deadline_text=body.get("deadline_text"),
        focus_areas=body.get("focus_areas", []),
        status=status,
        achievements_count=int(body.get("achievements_count", 0)),
        calls_count=int(body.get("calls_count", 0)),
        special_notes=body.get("special_notes"),
    )
    db.add(pp)
    await db.commit()
    await db.refresh(pp)
    return _pp_to_dict(pp)


@router.patch("/{pp_id}")
async def update_portfolio(
    pp_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(PortfolioProgress).where(PortfolioProgress.id == pp_id))
    pp = result.scalar_one_or_none()
    if not pp:
        raise HTTPException(status_code=404, detail="Запись УП не найдена")

    require_access(current_user, "portfolio", Action.manage)

    for field in ["vpp_group", "first_call_milestone", "deadline_text", "focus_areas", "special_notes"]:
        if field in body:
            setattr(pp, field, body[field])

    if "status" in body:
        try:
            pp.status = PortfolioStatus(body["status"])
        except ValueError:
            pass
    if "achievements_count" in body:
        pp.achievements_count = int(body["achievements_count"])
    if "calls_count" in body:
        pp.calls_count = int(body["calls_count"])

    pp.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(pp)
    return _pp_to_dict(pp)


@router.get("/student/{student_id}")
async def get_portfolio(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "portfolio", Action.manage)
    result = await db.execute(select(PortfolioProgress).where(PortfolioProgress.student_id == student_id))
    pp = result.scalar_one_or_none()
    if not pp:
        raise HTTPException(status_code=404, detail="Запись УП не найдена")
    return _pp_to_dict(pp)


def _pp_to_dict(pp: PortfolioProgress) -> dict:
    return {
        "id": str(pp.id),
        "student_id": str(pp.student_id),
        "vpp_group": pp.vpp_group,
        "first_call_milestone": pp.first_call_milestone,
        "deadline_text": pp.deadline_text,
        "focus_areas": pp.focus_areas or [],
        "status": pp.status.value,
        "achievements_count": pp.achievements_count,
        "calls_count": pp.calls_count,
        "special_notes": pp.special_notes,
        "updated_at": pp.updated_at.isoformat(),
    }
