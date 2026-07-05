from __future__ import annotations
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.core.database import get_db
from app.core.security import hash_password
from app.core.deps import CurrentUser, AdminOnly
from app.models.user import User, UserRole

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    role: str | None = None,
    is_active: bool | None = None,
):
    if current_user.role != UserRole.admin:
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


@router.post("", dependencies=[AdminOnly])
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


@router.get("/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return _user_to_dict(user)


@router.patch("/{user_id}", dependencies=[AdminOnly])
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

    if "name" in body:
        user.name = body["name"].strip()
    if "role" in body:
        try:
            user.role = UserRole(body["role"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная роль")
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


@router.delete("/{user_id}", dependencies=[AdminOnly])
async def deactivate_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
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
