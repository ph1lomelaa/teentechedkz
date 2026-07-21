from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.core.country_flags_data import flag_for, code_for
from app.models.country_reference import CountryReference
from app.models.user import UserRole

router = APIRouter(prefix="/countries", tags=["countries"])
COUNTRY_EDIT_ROLES = (UserRole.admin, UserRole.mzk_manager)
COUNTRY_DEGREE_LEVELS = {"undergraduate", "graduate"}


def _degree_levels(value) -> list[str]:
    if not isinstance(value, list):
        return ["undergraduate", "graduate"]
    cleaned = [item for item in value if item in COUNTRY_DEGREE_LEVELS]
    return cleaned or ["undergraduate", "graduate"]


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
    if current_user.role not in COUNTRY_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    name = body.get("country_name", "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Название страны обязательно")
    emoji, url = flag_for(name)
    c = CountryReference(
        country_name=name,
        vpp_required=body.get("vpp_required", False),
        submission_deadline_notes=body.get("submission_deadline_notes"),
        notes=body.get("notes"),
        code=code_for(name),
        flag_emoji=emoji,
        flag_url=url,
        degree_levels=_degree_levels(body.get("degree_levels")),
    )
    db.add(c)
    await db.flush()
    await log_change(
        db, "country_reference", c.id, "created", None, c.country_name,
        str(current_user.id), source="workspace_countries",
    )
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
    if current_user.role not in COUNTRY_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(CountryReference).where(CountryReference.id == country_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Страна не найдена")

    if "country_name" in body:
        body["country_name"] = str(body["country_name"]).strip()
        if not body["country_name"]:
            raise HTTPException(status_code=422, detail="Название страны обязательно")
    if "degree_levels" in body:
        body["degree_levels"] = _degree_levels(body["degree_levels"])
    for field in ["country_name", "vpp_required", "submission_deadline_notes", "notes", "degree_levels"]:
        if field in body:
            old_value = getattr(c, field)
            setattr(c, field, body[field])
            if old_value != body[field]:
                await log_change(
                    db, "country_reference", c.id, field, old_value, body[field],
                    str(current_user.id), source="workspace_countries",
                )

    # Re-resolve flags when the name changes or flags are still empty.
    if "country_name" in body or not c.flag_url:
        emoji, url = flag_for(c.country_name)
        if url or not c.flag_url:
            c.code = code_for(c.country_name)
            c.flag_emoji = emoji
            c.flag_url = url

    await db.commit()
    await db.refresh(c)
    return _country_to_dict(c)


@router.delete("/{country_id}")
async def delete_country(
    country_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in COUNTRY_EDIT_ROLES:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(CountryReference).where(CountryReference.id == country_id))
    c = result.scalar_one_or_none()
    if not c:
        raise HTTPException(status_code=404, detail="Страна не найдена")

    await log_change(
        db, "country_reference", c.id, "deleted", c.country_name, None,
        str(current_user.id), source="workspace_countries",
    )
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
        "code": c.code,
        "flag_emoji": c.flag_emoji,
        "flag_url": c.flag_url,
        "degree_levels": c.degree_levels or ["undergraduate", "graduate"],
    }
