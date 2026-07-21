"""Student invite-token lifecycle (Приоритет 1).

Issue → resolve → accept. The raw token is returned once (it goes into the
invite URL); only its SHA-256 hash is persisted. Issuing a fresh invite drops
any previous unused one for that user, so only the latest link works.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models.student_invite import StudentInvite
from app.models.user import User
from app.services.sessions import revoke_all_sessions

logger = logging.getLogger(__name__)

INVITE_TTL_HOURS = 72  # plan default; see "Решения, которые нужно согласовать"
INVITE_CODE_LENGTH = 8  # 8-character alphanumeric code, ~42-bit entropy


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _gen_code() -> str:
    """Generate a human-typeable 8-character code (uppercase + digits, no 0/O/I/1/l)."""
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # exclude 0/O, I/1/l
    return "".join(secrets.choice(alphabet) for _ in range(INVITE_CODE_LENGTH))


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.upper().encode()).hexdigest()


def invite_url(raw_token: str) -> str:
    return f"{settings.FRONTEND_URL}/invite/{raw_token}"


async def issue_invite(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    student_id: uuid.UUID | None,
    created_by: uuid.UUID | None,
    ttl_hours: int = INVITE_TTL_HOURS,
) -> tuple[StudentInvite, str, str]:
    """Create a fresh single-use invite with token + code, superseding any prior unused one.
    Returns (invite, raw_token, code). Does not commit."""
    await db.execute(
        delete(StudentInvite).where(
            StudentInvite.user_id == user_id,
            StudentInvite.used_at.is_(None),
        )
    )
    raw_token = secrets.token_urlsafe(32)
    raw_code = _gen_code()
    invite = StudentInvite(
        user_id=user_id,
        student_id=student_id,
        token_hash=_hash_token(raw_token),
        code_hash=_hash_code(raw_code),
        created_by=created_by,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
    )
    db.add(invite)
    return invite, raw_token, raw_code


def is_invite_usable(invite: StudentInvite, now: datetime | None = None) -> bool:
    """A token is usable while it's neither consumed nor past its expiry."""
    now = now or datetime.now(timezone.utc)
    return invite.used_at is None and invite.expires_at > now


async def resolve_valid_invite(
    db: AsyncSession, raw_token: str | None = None, raw_code: str | None = None, now: datetime | None = None
) -> StudentInvite | None:
    """Return the invite iff token/code exists, is unused and not expired.
    Pass raw_token (URL-based) or raw_code (user-typed activation code).
    Logs the exact rejection reason for debugging."""
    now = now or datetime.now(timezone.utc)

    if raw_token:
        result = await db.execute(
            select(StudentInvite).where(StudentInvite.token_hash == _hash_token(raw_token))
        )
        lookup_method = f"token (len={len(raw_token)})"
    elif raw_code:
        result = await db.execute(
            select(StudentInvite).where(StudentInvite.code_hash == _hash_code(raw_code))
        )
        lookup_method = f"code={raw_code.upper()}"
    else:
        logger.error("resolve_valid_invite: neither token nor code provided")
        return None

    invite = result.scalar_one_or_none()
    if not invite:
        logger.info("Invite rejected: %s not found (possibly superseded or typo).", lookup_method)
        return None
    if invite.used_at is not None:
        logger.info(
            "Invite rejected: already used at %s (user_id=%s).", invite.used_at, invite.user_id
        )
        return None
    if invite.expires_at <= now:
        logger.info(
            "Invite rejected: expired at %s, now %s (user_id=%s).",
            invite.expires_at, now, invite.user_id,
        )
        return None
    return invite


async def accept_invite(db: AsyncSession, invite: StudentInvite, new_password: str) -> User:
    """Consume the invite: set the permanent password, activate the account,
    burn the link and clear any pre-existing sessions. Does not commit."""
    user = await db.get(User, invite.user_id)
    if user is None:
        raise ValueError("invite points to a missing user")
    user.hashed_password = hash_password(new_password)
    user.must_change_password = False
    user.is_active = True
    invite.used_at = datetime.now(timezone.utc)
    await revoke_all_sessions(db, user.id)
    return user
