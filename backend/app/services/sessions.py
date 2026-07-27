"""Session (refresh-token) lifecycle helpers (Этап 0.3).

Centralises "end all active sessions of a user" so password change, staff
reset, and account deactivation share one correct implementation. Marks every
non-revoked refresh token as revoked; does NOT commit — the caller owns the
transaction.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token
from app.models.user import RefreshToken, User

COOKIE_NAME = "refresh_token"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.ENVIRONMENT != "development",
        samesite="lax",
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
        path="/api/v1/auth",
    )


async def issue_session(db: AsyncSession, response: Response, user: User) -> dict:
    """Issue a fresh access+refresh token pair for `user` and set the refresh
    cookie — the same shape /auth/login returns. Used both by login and by
    invite-acceptance (student/staff), so setting a password and landing in
    the portal is a single step instead of a second manual login.

    Does not commit — the caller owns the transaction.
    """
    access_token = create_access_token({"sub": str(user.id), "role": user.role.value})
    refresh_token_raw = create_refresh_token()
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=hash_token(refresh_token_raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    ))
    set_refresh_cookie(response, refresh_token_raw)
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


async def revoke_all_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    keep_token_hash: str | None = None,
) -> int:
    """Revoke all active refresh tokens for a user.

    `keep_token_hash` spares one token (the acting device) so a self-service
    password change logs out *other* devices without kicking out the current
    one. Returns the number of tokens revoked.
    """
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked == False,  # noqa: E712
        )
    )
    revoked = 0
    for token in result.scalars().all():
        if keep_token_hash is not None and token.token_hash == keep_token_hash:
            continue
        token.revoked = True
        revoked += 1
    return revoked
