"""Session (refresh-token) lifecycle helpers (Этап 0.3).

Centralises "end all active sessions of a user" so password change, staff
reset, and account deactivation share one correct implementation. Marks every
non-revoked refresh token as revoked; does NOT commit — the caller owns the
transaction.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import RefreshToken


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
