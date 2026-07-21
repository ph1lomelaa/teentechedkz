from __future__ import annotations
import secrets
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.core.database import get_db
from app.core.security import hash_password
from app.core.deps import CurrentUser, AdminOnly, AdminOrMZK
from app.models.user import User, UserRole
from app.services.invites import issue_invite, invite_url

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    role: str | None = None,
    is_active: bool | None = None,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")

    query = select(User)
    if role:
        try:
            query = query.where(User.role == UserRole(role))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Unknown role: {role}")
    if is_active is not None:
        query = query.where(User.is_active == is_active)

    result = await db.execute(query.order_by(User.name))
    users = result.scalars().all()
    return [_user_to_dict(u) for u in users]


@router.post("", dependencies=[AdminOrMZK])
async def create_user(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    email = body.get("email", "").strip().lower()
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email уже занят")

    password = body.get("password", "")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Пароль минимум 8 символов")

    try:
        role = UserRole(body.get("role", "mentor"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная роль")

    user = User(
        name=body.get("name", "").strip(),
        email=email,
        hashed_password=hash_password(password),
        role=role,
        phone=body.get("phone"),
        telegram_username=body.get("telegram_username"),
        must_change_password=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@router.post("/invite", dependencies=[AdminOrMZK])
async def create_user_invite(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Create a staff account (mentor/manager/admin) without a password and hand
    back a single-use invite link — the invitee sets their own password, exactly
    like a student (п.7). The account stays inactive until the invite is accepted."""
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="Email обязателен")
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email уже занят")

    try:
        role = UserRole(body.get("role", "mentor"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная роль")
    if role == UserRole.student:
        raise HTTPException(status_code=422, detail="Ученику доступ выдаётся из карточки студента")

    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Имя обязательно")

    user = User(
        name=name,
        email=email,
        # Placeholder secret so the row is never login-able until the invite is
        # accepted (which replaces it with the user's own password).
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        role=role,
        phone=body.get("phone"),
        is_active=False,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    invite, raw_token, raw_code = await issue_invite(
        db, user_id=user.id, student_id=None, created_by=current_user.id
    )
    await db.commit()
    await db.refresh(user)
    return {
        **_user_to_dict(user),
        "invite_url": invite_url(raw_token),
        "invite_code": raw_code,
        "invite_expires_at": invite.expires_at.isoformat(),
    }


@router.get("/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return _user_to_dict(user)


@router.patch("/{user_id}", dependencies=[AdminOrMZK])
async def update_user(
    user_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    is_self = user_id == current_user.id
    if is_self and body.get("is_active") is False:
        raise HTTPException(status_code=400, detail="Нельзя деактивировать самого себя")

    if "name" in body:
        user.name = body["name"].strip()
    if "role" in body:
        try:
            new_role = UserRole(body["role"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная роль")
        if is_self and new_role != UserRole.admin:
            raise HTTPException(status_code=400, detail="Нельзя понизить собственную роль — попросите другого администратора")
        user.role = new_role
    if "phone" in body:
        user.phone = body["phone"]
    if "telegram_username" in body:
        user.telegram_username = body["telegram_username"]
    if "telegram_id" in body:
        user.telegram_id = body["telegram_id"]
    if "is_active" in body:
        user.is_active = body["is_active"]
    if "password" in body:
        p = body["password"]
        if len(p) < 8:
            raise HTTPException(status_code=422, detail="Пароль минимум 8 символов")
        user.hashed_password = hash_password(p)
        user.must_change_password = True

    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@router.delete("/{user_id}", dependencies=[AdminOrMZK])
async def deactivate_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя деактивировать самого себя")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.is_active = False
    await db.commit()
    return {"message": "Пользователь деактивирован"}


def _user_to_dict(u: User) -> dict:
    return {
        "id": str(u.id),
        "name": u.name,
        "email": u.email,
        "role": u.role.value,
        "telegram_id": u.telegram_id,
        "telegram_username": u.telegram_username,
        "phone": u.phone,
        "is_active": u.is_active,
        "must_change_password": u.must_change_password,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }
