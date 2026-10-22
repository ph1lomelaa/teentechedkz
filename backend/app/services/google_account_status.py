"""Google confirmation status, based on verified OAuth actions, not email domains.

The primary address can itself be a Google account. An extra address entered by
staff is not proof of Google ownership. Only successful OAuth confirmations of
addresses still belonging to this user count; unlink events invalidate them.
"""
from __future__ import annotations

import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditAction, AuditLog
from app.models.user import User
from app.models.user_email import UserEmail
from app.services.user_emails import norm


def confirmed_accounts(users: list[User], extras: list[UserEmail], events: list[AuditLog]) -> dict[uuid.UUID, dict]:
    allowed = {u.id: {norm(u.email)} for u in users}
    for extra in extras:
        if extra.user_id in allowed and extra.is_verified:
            allowed[extra.user_id].add(norm(extra.email))

    # Events arrive newest first. The latest action for each address wins.
    seen: set[tuple[uuid.UUID, str]] = set()
    confirmed: dict[uuid.UUID, set[str]] = {u.id: set() for u in users}
    for event in events:
        user_id = event.actor_user_id
        meta = event.meta or {}
        email = norm(str(meta.get("google_email") or meta.get("email") or ""))
        if user_id not in allowed or not email or email not in allowed[user_id]:
            continue
        key = (user_id, email)
        if key in seen:
            continue
        if event.action == AuditAction.login_success and meta.get("method") != "google":
            continue
        seen.add(key)
        if event.action in {AuditAction.google_linked, AuditAction.login_success}:
            confirmed[user_id].add(email)
    return {user_id: {"linked": bool(emails), "emails": sorted(emails)} for user_id, emails in confirmed.items()}


async def google_accounts_by_user(
    db: AsyncSession, users: list[User], *, extras: list[UserEmail] | None = None,
) -> dict[uuid.UUID, dict]:
    if not users:
        return {}
    ids = [u.id for u in users]
    if extras is None:
        result = await db.execute(select(UserEmail).where(UserEmail.user_id.in_(ids)))
        extras = list(result.scalars().all())
    result = await db.execute(
        select(AuditLog).where(
            AuditLog.actor_user_id.in_(ids),
            or_(
                AuditLog.action.in_([AuditAction.google_linked, AuditAction.google_unlinked]),
                and_(AuditLog.action == AuditAction.login_success, AuditLog.meta["method"].astext == "google"),
            ),
        ).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    )
    return confirmed_accounts(users, extras, list(result.scalars().all()))
