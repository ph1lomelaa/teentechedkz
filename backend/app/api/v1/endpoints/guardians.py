from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.encryption import encrypt, decrypt, mask_iin
from app.models.guardian import Guardian, GuardianRelation
from app.models.user import UserRole

router = APIRouter(prefix="/guardians", tags=["guardians"])


def _require_admin_mzk(user):
    if user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")


@router.get("/student/{student_id}")
async def get_guardians(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Guardian).where(Guardian.student_id == student_id))
    guardians = result.scalars().all()
    return [_guardian_to_dict(g, reveal_iin=False) for g in guardians]


@router.get("/{guardian_id}/reveal-iin")
async def reveal_iin(
    guardian_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)
    result = await db.execute(select(Guardian).where(Guardian.id == guardian_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=404, detail="Подписант не найден")

    from app.core.audit import log_change
    await log_change(db, "guardian", g.id, "iin_revealed", None, "revealed", str(current_user.id), "manual")
    await db.commit()

    plain_iin = None
    if g.iin_encrypted:
        try:
            plain_iin = decrypt(g.iin_encrypted)
        except Exception:
            plain_iin = "[decrypt error]"

    return {"iin": plain_iin}


@router.post("")
async def create_guardian(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    iin_plain = body.get("iin", "")
    if iin_plain and (not iin_plain.isdigit() or len(iin_plain) != 12):
        raise HTTPException(status_code=422, detail="ИИН должен содержать 12 цифр", headers={"X-Error-Code": "HUMAN_ONLY_FIELD"})

    try:
        relation = GuardianRelation(body.get("relation", "parent"))
    except ValueError:
        relation = GuardianRelation.parent

    g = Guardian(
        student_id=uuid.UUID(body["student_id"]),
        full_name=body.get("full_name", "").strip(),
        iin_encrypted=encrypt(iin_plain) if iin_plain else None,
        phone=body.get("phone", "").strip(),
        email=body.get("email"),
        relation=relation,
        is_primary=body.get("is_primary", True),
    )
    db.add(g)
    await db.commit()
    await db.refresh(g)
    return _guardian_to_dict(g, reveal_iin=False)


@router.patch("/{guardian_id}")
async def update_guardian(
    guardian_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Guardian).where(Guardian.id == guardian_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=404, detail="Подписант не найден")

    if "full_name" in body:
        g.full_name = body["full_name"].strip()
    if "phone" in body:
        g.phone = body["phone"].strip()
    if "email" in body:
        g.email = body["email"]
    if "is_primary" in body:
        g.is_primary = body["is_primary"]
    if "iin" in body:
        iin = body["iin"]
        if iin and (not iin.isdigit() or len(iin) != 12):
            raise HTTPException(status_code=422, detail="ИИН должен содержать 12 цифр")
        g.iin_encrypted = encrypt(iin) if iin else None

    await db.commit()
    await db.refresh(g)
    return _guardian_to_dict(g, reveal_iin=False)


@router.delete("/{guardian_id}")
async def delete_guardian(
    guardian_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Guardian).where(Guardian.id == guardian_id))
    g = result.scalar_one_or_none()
    if not g:
        raise HTTPException(status_code=404, detail="Подписант не найден")
    await db.delete(g)
    await db.commit()
    return {"message": "Deleted"}


def _guardian_to_dict(g: Guardian, reveal_iin: bool = False) -> dict:
    iin_val = None
    if g.iin_encrypted:
        if reveal_iin:
            try:
                iin_val = decrypt(g.iin_encrypted)
            except Exception:
                iin_val = "[decrypt error]"
        else:
            try:
                plain = decrypt(g.iin_encrypted)
                iin_val = mask_iin(plain)
            except Exception:
                iin_val = "●●●●●●●●●●●●"

    return {
        "id": str(g.id),
        "student_id": str(g.student_id),
        "full_name": g.full_name,
        "iin_masked": iin_val if not reveal_iin else None,
        "iin": iin_val if reveal_iin else None,
        "phone": g.phone,
        "email": g.email,
        "relation": g.relation.value,
        "is_primary": g.is_primary,
    }
