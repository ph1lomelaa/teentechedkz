from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.intake_submission import IntakeSource, IntakeStatus, IntakeSubmission

router = APIRouter(prefix="/public", tags=["public"])


class PublicApplicationCreate(BaseModel):
    full_name: str
    phone: str
    email: EmailStr | None = None
    city: str | None = None
    degree_level: str | None = None
    intake_year: int | None = None
    target_country: str | None = None
    program_interest: str | None = None
    message: str | None = None


@router.post("/applications", status_code=status.HTTP_201_CREATED)
async def create_public_application(
    body: PublicApplicationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    full_name = body.full_name.strip()
    phone = body.phone.strip()
    if len(full_name) < 2:
        raise HTTPException(status_code=422, detail="Укажите имя")
    if len(phone) < 5:
        raise HTTPException(status_code=422, detail="Укажите телефон")

    now = datetime.now(timezone.utc)
    raw_data = {
        "full_name": full_name,
        "phone": phone,
        "email": str(body.email) if body.email else "",
        "city": body.city or "",
        "degree_level": body.degree_level or "",
        "intake_year": body.intake_year or "",
        "target_country": body.target_country or "",
        "program_interest": body.program_interest or "",
        "message": body.message or "",
        "source": "landing_apply",
    }
    fingerprint_src = f"landing_apply|{now.isoformat()}|{full_name}|{phone}|{body.email or ''}"
    submission = IntakeSubmission(
        source=IntakeSource.cases,
        submitted_at=now,
        row_fingerprint=hashlib.sha256(fingerprint_src.encode("utf-8")).hexdigest(),
        raw_data=raw_data,
        full_name=full_name,
        phone_normalized=phone,
        manager_name=None,
        status=IntakeStatus.new,
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return {
        "id": str(submission.id),
        "status": submission.status.value,
        "message": "Заявка отправлена. Команда TeenTechEd свяжется с вами.",
    }
