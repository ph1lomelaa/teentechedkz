from __future__ import annotations
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token
from app.core.config import settings
from app.core.deps import get_current_user, CurrentUser
from app.models.user import User
from app.models.user import RefreshToken

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "refresh_token"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.ENVIRONMENT != "development",
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/api/v1/auth",
    )


@router.post("/login")
async def login(
    body: dict,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт деактивирован")

    access_token = create_access_token({"sub": str(user.id), "role": user.role.value})
    refresh_token_raw = create_refresh_token()

    rt = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(refresh_token_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)
    await db.commit()

    _set_refresh_cookie(response, refresh_token_raw)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "role": user.role.value,
            "must_change_password": user.must_change_password,
        },
    }


@router.post("/refresh")
async def refresh(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    refresh_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")

    token_hash = _hash_token(refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked == False,  # noqa: E712
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Rotate refresh token
    rt.revoked = True
    new_refresh_raw = create_refresh_token()
    new_rt = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(new_refresh_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(new_rt)
    await db.commit()

    new_access = create_access_token({"sub": str(user.id), "role": user.role.value})
    _set_refresh_cookie(response, new_refresh_raw)

    return {
        "access_token": new_access,
        "token_type": "bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@router.post("/logout")
async def logout(
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    refresh_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
):
    if refresh_token:
        token_hash = _hash_token(refresh_token)
        result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        rt = result.scalar_one_or_none()
        if rt:
            rt.revoked = True
            await db.commit()

    response.delete_cookie(key=COOKIE_NAME, path="/api/v1/auth")
    return {"message": "Logged out successfully"}


@router.get("/me")
async def me(current_user: CurrentUser):
    return {
        "id": str(current_user.id),
        "name": current_user.name,
        "email": current_user.email,
        "role": current_user.role.value,
        "telegram_username": current_user.telegram_username,
        "phone": current_user.phone,
        "is_active": current_user.is_active,
        "must_change_password": current_user.must_change_password,
    }


@router.post("/change-password")
async def change_password(
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")

    if len(new_password) < 8:
        raise HTTPException(status_code=422, detail="Пароль должен быть минимум 8 символов")

    if not verify_password(old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")

    current_user.hashed_password = hash_password(new_password)
    current_user.must_change_password = False
    await db.commit()
    return {"message": "Пароль изменён"}
