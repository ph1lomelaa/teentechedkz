from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.models.intake_submission import IntakeSource, IntakeStatus, IntakeSubmission
from app.models.notification import Notification
from app.models.user import User, UserRole
from app.services import rate_limit

router = APIRouter(prefix="/public", tags=["public"])
PUBLIC_APPLICATION_DEDUPE_SECONDS = 300


async def _notify_admins(db: AsyncSession, *, kind: str, title: str, body: str, link: str) -> None:
    admins = await db.execute(select(User).where(User.role.in_([UserRole.admin, UserRole.mzk_manager])))
    for admin in admins.scalars():
        db.add(Notification(
            user_id=admin.id,
            kind=kind,
            title=title,
            body=body,
            link=link,
            priority="high",
        ))


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
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await rate_limit.enforce(
        request, bucket="public_application", limit=8, window_seconds=300
    )

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
    # A double click / browser retry within the same five-minute bucket should
    # not create a second lead and a second admin notification.
    bucket = int(now.timestamp()) // PUBLIC_APPLICATION_DEDUPE_SECONDS
    fingerprint_src = (
        f"landing_apply|{bucket}|{full_name.lower()}|{phone}|"
        f"{str(body.email).lower() if body.email else ''}"
    )
    fingerprint = hashlib.sha256(fingerprint_src.encode("utf-8")).hexdigest()
    existing = (
        await db.execute(
            select(IntakeSubmission).where(
                IntakeSubmission.row_fingerprint == fingerprint
            )
        )
    ).scalar_one_or_none()
    if existing:
        return {
            "id": str(existing.id),
            "status": existing.status.value,
            "message": "Заявка уже отправлена. Команда TeenTechEd свяжется с вами.",
        }

    submission = IntakeSubmission(
        source=IntakeSource.cases,
        submitted_at=now,
        row_fingerprint=fingerprint,
        raw_data=raw_data,
        full_name=full_name,
        phone_normalized=phone,
        manager_name=None,
        status=IntakeStatus.new,
    )
    db.add(submission)
    await _notify_admins(
        db,
        kind="intake",
        title="Новая заявка от абитуриента",
        body=f"{full_name} · {phone}",
        link="/students?inbox=1",
    )
    try:
        await db.commit()
    except IntegrityError:
        # Two identical requests can race between the SELECT above and INSERT.
        # The unique fingerprint is the final arbiter; return the winner rather
        # than leaking a 500 to the applicant.
        await db.rollback()
        existing = (
            await db.execute(
                select(IntakeSubmission).where(
                    IntakeSubmission.row_fingerprint == fingerprint
                )
            )
        ).scalar_one_or_none()
        if not existing:
            raise
        return {
            "id": str(existing.id),
            "status": existing.status.value,
            "message": "Заявка уже отправлена. Команда TeenTechEd свяжется с вами.",
        }
    await db.refresh(submission)
    return {
        "id": str(submission.id),
        "status": submission.status.value,
        "message": "Заявка отправлена. Команда TeenTechEd свяжется с вами.",
    }


class MentorSignupCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str | None = None
    password: str


@router.post("/mentor-signup", status_code=status.HTTP_201_CREATED)
async def mentor_signup(
    body: MentorSignupCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Самостоятельная заявка ментора: аккаунт создаётся неактивным,
    доступ открывает администратор в настройках пользователей."""
    await rate_limit.enforce(request, bucket="mentor_signup", limit=10, window_seconds=300)

    name = body.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Укажите имя")
    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Пароль должен быть минимум 8 символов")

    email = str(body.email).strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Пользователь с таким email уже существует. Попробуйте войти.",
        )

    user = User(
        name=name,
        email=email,
        phone=body.phone.strip() if body.phone else None,
        hashed_password=hash_password(body.password),
        role=UserRole.mentor,
        is_active=False,
    )
    db.add(user)
    await _notify_admins(
        db,
        kind="mentor_signup",
        title="Новая заявка от ментора",
        body=f"{name} · {email} — ждёт активации и назначения роли",
        link="/settings/users",
    )
    await db.commit()
    return {
        "message": "Заявка отправлена. Администратор проверит её и откроет доступ — после этого можно войти.",
    }
