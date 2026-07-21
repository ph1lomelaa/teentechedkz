from __future__ import annotations
import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, Cookie, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import hash_password, verify_password, create_access_token, create_refresh_token
from app.core.config import settings
from app.core.deps import get_current_user, CurrentUser
from app.models.user import User
from app.models.user import RefreshToken
from app.models.audit_log import AuditAction
from app.services.audit import record_audit
from app.services.sessions import revoke_all_sessions
from app.services import rate_limit
from app.services.user_emails import resolve_user_by_email

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
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    # Throttle by IP (a single source hammering many accounts) and by email
    # (a distributed attack on one account). Both must pass.
    await rate_limit.enforce(request, bucket="login_ip", limit=30, window_seconds=300)
    if email:
        await rate_limit.enforce(
            request, bucket="login_email", limit=8, window_seconds=300, subject=email
        )

    user = await resolve_user_by_email(db, email)

    if not user or not verify_password(password, user.hashed_password):
        record_audit(
            db,
            action=AuditAction.login_failed,
            actor_email=email,
            target_user_id=user.id if user else None,
            request=request,
            meta={"reason": "bad_credentials"},
        )
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    if not user.is_active:
        record_audit(
            db,
            action=AuditAction.login_failed,
            actor=user,
            target_user_id=user.id,
            request=request,
            meta={"reason": "inactive"},
        )
        await db.commit()
        # 401, а не 403: глобальный handler маскирует 403 в «Access denied»,
        # а ждущий одобрения ментор должен увидеть причину.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Аккаунт неактивен. Если вы недавно оставили заявку — дождитесь одобрения администратора.",
        )

    user.last_login_at = datetime.now(timezone.utc)

    access_token = create_access_token({"sub": str(user.id), "role": user.role.value})
    refresh_token_raw = create_refresh_token()

    rt = RefreshToken(
        user_id=user.id,
        token_hash=_hash_token(refresh_token_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(rt)
    record_audit(
        db,
        action=AuditAction.login_success,
        actor=user,
        target_user_id=user.id,
        request=request,
    )
    await db.commit()

    # Successful auth clears the per-email throttle so a legit user who fat-
    # fingered a few times isn't held back on the next login.
    await rate_limit.reset(bucket="login_email", subject=email)

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
    request: Request,
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
    record_audit(
        db,
        action=AuditAction.logout,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
    )
    await db.commit()

    response.delete_cookie(key=COOKIE_NAME, path="/api/v1/auth")
    return {"message": "Logged out successfully"}


@router.post("/logout-all")
async def logout_all(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Завершить все активные сессии пользователя на всех устройствах."""
    count = await revoke_all_sessions(db, current_user.id)
    record_audit(
        db,
        action=AuditAction.sessions_revoked,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
        meta={"revoked": count, "reason": "logout_all"},
    )
    await db.commit()
    response.delete_cookie(key=COOKIE_NAME, path="/api/v1/auth")
    return {"message": "Все сессии завершены", "revoked": count}


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
    request: Request,
    response: Response,
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

    # End every existing session, then issue a fresh one for this device so the
    # user who just changed their password stays logged in here while all other
    # devices are signed out.
    revoked = await revoke_all_sessions(db, current_user.id)
    new_refresh_raw = create_refresh_token()
    db.add(
        RefreshToken(
            user_id=current_user.id,
            token_hash=_hash_token(new_refresh_raw),
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    record_audit(
        db,
        action=AuditAction.password_changed,
        actor=current_user,
        target_user_id=current_user.id,
        request=request,
        meta={"other_sessions_revoked": revoked},
    )
    await db.commit()
    _set_refresh_cookie(response, new_refresh_raw)
    return {"message": "Пароль изменён"}
