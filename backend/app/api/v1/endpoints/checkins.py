"""Ежедневный чекин сотрудника «я на месте».

Правила окна и статусов — в services/checkins.py (там же тесты). Здесь только
маршруты: отметиться, посмотреть своё сегодня, сводка для МЗК/админа.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.user import User, UserRole
from app.models.user_checkin import CheckinStatus, UserCheckin
from app.services.checkins import (
    CHECKIN_ROLES,
    checkin_status_for,
    is_checkin_role,
    is_workday,
    local_now,
)

router = APIRouter(prefix="/checkins", tags=["checkins"])

def _to_dict(c: UserCheckin, *, with_user: bool = False) -> dict:
    d = {
        "id": str(c.id),
        "user_id": str(c.user_id),
        "checkin_date": c.checkin_date.isoformat(),
        "status": c.status.value,
        "checked_in_at": c.checked_in_at.isoformat() if c.checked_in_at else None,
        "note": c.note,
    }
    if with_user and c.user:
        d["user_name"] = c.user.name
        d["user_role"] = c.user.role.value
    return d


def _window() -> dict:
    return {
        "hour": settings.CHECKIN_HOUR,
        "minute": settings.CHECKIN_MINUTE,
        "grace_minutes": settings.CHECKIN_GRACE_MINUTES,
        "timezone": settings.COMPANY_TIMEZONE,
    }


@router.get("/me/today")
async def my_checkin_today(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """Состояние кнопки «Я на месте» на сегодня.

    Отвечает всем ролям, а не только обязанным: фронт рисует виджет по
    `required`, и отдельная ветка на 403 ему не нужна.
    """
    now_local = local_now(settings.COMPANY_TIMEZONE)
    today = now_local.date()
    required = is_checkin_role(current_user.role) and is_workday(today)

    existing = (
        await db.execute(
            select(UserCheckin).where(
                UserCheckin.user_id == current_user.id,
                UserCheckin.checkin_date == today,
            )
        )
    ).scalar_one_or_none()

    return {
        "date": today.isoformat(),
        "required": required,
        "checkin": _to_dict(existing) if existing else None,
        "window": _window(),
    }


@router.post("/me")
async def check_in(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    body: dict | None = None,
):
    if not is_checkin_role(current_user.role):
        raise HTTPException(
            status_code=403,
            detail="Чекин обязателен для менторов и МЗК",
            headers={"X-Error-Code": "CHECKIN_NOT_REQUIRED"},
        )

    now_local = local_now(settings.COMPANY_TIMEZONE)
    today = now_local.date()
    status = checkin_status_for(
        checked_in_local=now_local,
        hour=settings.CHECKIN_HOUR,
        minute=settings.CHECKIN_MINUTE,
        grace_minutes=settings.CHECKIN_GRACE_MINUTES,
    )

    checkin = UserCheckin(
        user_id=current_user.id,
        checkin_date=today,
        status=status,
        checked_in_at=datetime.now(timezone.utc),
        note=(body or {}).get("note"),
    )
    # Проверяем до вставки: типичный повтор — это просто второе нажатие
    # кнопки, и ловить его исключением дороже, чем одним SELECT.
    existing = (
        await db.execute(
            select(UserCheckin).where(
                UserCheckin.user_id == current_user.id,
                UserCheckin.checkin_date == today,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return _to_dict(existing)

    db.add(checkin)
    try:
        await db.flush()
        await db.commit()
    except IntegrityError:
        # Уникальный индекс (user_id, checkin_date): повторное нажатие или
        # гонка с фоновой простановкой `missed`. Отдаём существующую отметку,
        # а не 409 — для пользователя это тот же успешный исход.
        await db.rollback()
        existing = (
            await db.execute(
                select(UserCheckin).where(
                    UserCheckin.user_id == current_user.id,
                    UserCheckin.checkin_date == today,
                )
            )
        ).scalar_one_or_none()
        if existing is None:
            raise
        return _to_dict(existing)

    await db.refresh(checkin)
    return _to_dict(checkin)


@router.get("")
async def list_checkins(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    date_from: date | None = None,
    date_to: date | None = None,
    user_id: uuid.UUID | None = None,
    days: int = Query(14, ge=1, le=92),
):
    """Сводка посещаемости за период — для МЗК и администратора."""
    require_access(current_user, "checkins", Action.view)

    today = local_now(settings.COMPANY_TIMEZONE).date()
    end = date_to or today
    start = date_from or (end - timedelta(days=days - 1))
    if start > end:
        raise HTTPException(status_code=422, detail="Начало периода позже конца")

    query = (
        select(UserCheckin)
        .options(selectinload(UserCheckin.user))
        .where(UserCheckin.checkin_date >= start, UserCheckin.checkin_date <= end)
        .order_by(UserCheckin.checkin_date.desc())
    )
    if user_id:
        query = query.where(UserCheckin.user_id == user_id)
    rows = (await db.execute(query)).scalars().all()

    staff = (
        await db.execute(
            select(User).where(
                User.role.in_(tuple(CHECKIN_ROLES)),
                User.is_active == True,  # noqa: E712
            )
        )
    ).scalars().all()

    return {
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "items": [_to_dict(c, with_user=True) for c in rows],
        "staff": [
            {"user_id": str(u.id), "user_name": u.name, "user_role": u.role.value}
            for u in sorted(staff, key=lambda u: u.name or "")
        ],
        "window": _window(),
    }


@router.get("/summary")
async def checkin_summary(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    days: int = Query(30, ge=1, le=92),
):
    """Счётчики по каждому сотруднику за период: вовремя / с опозданием / пропуски."""
    require_access(current_user, "checkins", Action.view)

    today = local_now(settings.COMPANY_TIMEZONE).date()
    start = today - timedelta(days=days - 1)

    rows = (
        await db.execute(
            select(UserCheckin)
            .options(selectinload(UserCheckin.user))
            .where(UserCheckin.checkin_date >= start, UserCheckin.checkin_date <= today)
        )
    ).scalars().all()

    per_user: dict[str, dict] = {}
    for c in rows:
        key = str(c.user_id)
        bucket = per_user.setdefault(
            key,
            {
                "user_id": key,
                "user_name": c.user.name if c.user else None,
                "user_role": c.user.role.value if c.user else None,
                "on_time": 0,
                "late": 0,
                "missed": 0,
            },
        )
        if c.status == CheckinStatus.on_time:
            bucket["on_time"] += 1
        elif c.status == CheckinStatus.late:
            bucket["late"] += 1
        else:
            bucket["missed"] += 1

    return {
        "date_from": start.isoformat(),
        "date_to": today.isoformat(),
        "items": sorted(per_user.values(), key=lambda r: r["user_name"] or ""),
    }
