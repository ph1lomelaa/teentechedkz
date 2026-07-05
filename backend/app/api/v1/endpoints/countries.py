from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.country_reference import CountryReference
from app.models.user import UserRole

router = APIRouter(prefix="/countries", tags=["countries"])


@router.get("")
async def list_countries(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(CountryReference).order_by(CountryReference.country_name))
    countries = result.scalars().all()
    return [_country_to_dict(c) for c in countries]


@router.post("")
async def create_country(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Only admin can manage countries")

    c = CountryReference(
        country_name=body.get("country_name", "").strip(),
        vpp_required=body.get("vpp_required", False),
        submission_deadline_notes=body.get("submission_deadline_notes"),
        notes=body.get("notes"),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _country_to_dict(c)


@router.patch("/{country_id}")
async def update_country(
    country_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Only admin can manage countries")

    result = await db.execute(select(CountryReference).where(CountryReference.id == country_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Страна не найдена")

    for field in ["country_name", "vpp_required", "submission_deadline_notes", "notes"]:
        if field in body:
            setattr(c, field, body[field])

    await db.commit()
    await db.refresh(c)
    return _country_to_dict(c)


@router.delete("/{country_id}")
async def delete_country(
    country_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Only admin can manage countries")

    result = await db.execute(select(CountryReference).where(CountryReference.id == country_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Страна не найдена")

    await db.delete(c)
    await db.commit()
    return {"message": "Deleted"}


def _country_to_dict(c: CountryReference) -> dict:
    return {
        "id": str(c.id),
        "country_name": c.country_name,
        "vpp_required": c.vpp_required,
        "submission_deadline_notes": c.submission_deadline_notes,
        "notes": c.notes,
    }
