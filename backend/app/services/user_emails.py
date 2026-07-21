"""Multi-email account helpers (Приоритет 1 / фундамент под Google).

`users.email` is the canonical primary; `user_emails` holds extra verified
addresses. Login and (later) Google matching accept the primary or any verified
secondary. Emails are normalised to lowercase everywhere.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.user_email import UserEmail

# Primary + this many extras. Plan default: up to two addresses per account.
MAX_EXTRA_EMAILS = 1


def norm(email: str) -> str:
    return email.strip().lower()


async def resolve_user_by_email(db: AsyncSession, email: str) -> User | None:
    """Find the account owning this address — primary first, then a verified
    secondary. Used by login so any confirmed email signs into the same user."""
    email = norm(email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        return user
    result = await db.execute(
        select(User)
        .join(UserEmail, UserEmail.user_id == User.id)
        .where(UserEmail.email == email, UserEmail.is_verified == True)  # noqa: E712
    )
    return result.scalar_one_or_none()


async def email_in_use(db: AsyncSession, email: str) -> bool:
    """True if the address is already a primary or any account's extra email."""
    email = norm(email)
    if (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none():
        return True
    return bool(
        (await db.execute(select(UserEmail.id).where(UserEmail.email == email))).scalar_one_or_none()
    )


async def list_extra_emails(db: AsyncSession, user_id: uuid.UUID) -> list[UserEmail]:
    result = await db.execute(
        select(UserEmail).where(UserEmail.user_id == user_id).order_by(UserEmail.created_at)
    )
    return list(result.scalars().all())
