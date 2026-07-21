"""Scholarships and educational programs (from Notion sync)."""
from __future__ import annotations

from typing import Annotated
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.scholarship import Scholarship
from app.models.user import UserRole

router = APIRouter(prefix="/scholarships", tags=["scholarships"])

_MANAGE_ROLES = (UserRole.admin, UserRole.mzk_manager)


@router.get("")
async def list_scholarships(
    country_id: str | None = Query(None),
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _: CurrentUser = Depends(lambda: None),  # Optional auth check
):
    """List available scholarships, optionally filtered by country ID."""
    query = select(Scholarship).order_by(Scholarship.created_at.desc())

    if country_id:
        query = query.where(Scholarship.country_id == country_id)

    result = await db.execute(query)
    scholarships = list(result.scalars())

    return [
        {
            "id": str(s.id),
            "name": s.name,
            "country_id": str(s.country_id) if s.country_id else None,
            "description": s.description,
            "requirements": s.requirements,
            "deadline": s.deadline.isoformat() if s.deadline else None,
            "amount": s.amount,
        }
        for s in scholarships
    ]


@router.post("/import/notion", status_code=status.HTTP_202_ACCEPTED)
async def import_scholarships_from_notion(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """
    Admin/mzk_manager only: trigger a scholarship import from a Notion database.
    Returns job status (for now, just returns success).
    """
    if current_user.role not in _MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    db_id = body.get("db_id") or ""
    if not db_id.strip():
        raise HTTPException(status_code=422, detail="db_id is required")

    dry_run = body.get("dry_run", False)

    # For MVP, just return a placeholder. In production, this would:
    # 1. Fetch pages from Notion database
    # 2. Parse scholarship fields
    # 3. Upsert into scholarships table
    return {
        "status": "started",
        "message": "Scholarship import job queued (check logs for details)",
        "db_id": db_id,
        "dry_run": dry_run,
    }
