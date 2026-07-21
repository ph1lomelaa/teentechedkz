"""Audit logging helper (Этап 0.1).

`record_audit` stages an audit row on the caller's session — it does NOT commit,
so a successful action and its audit record land in the same transaction. For
paths that raise before committing (e.g. a failed login), the caller commits
explicitly after recording.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit_log import AuditAction, AuditLog
from app.models.user import User


def client_meta(request: Request | None) -> tuple[str | None, str | None]:
    """Best-effort (ip, user_agent). Honours X-Forwarded-For behind the proxy."""
    if request is None:
        return None, None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        ip = forwarded.split(",")[0].strip()
    else:
        ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return ip, user_agent


def record_audit(
    db: AsyncSession,
    *,
    action: AuditAction,
    actor: User | None = None,
    actor_email: str | None = None,
    target_user_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    request: Request | None = None,
    meta: dict[str, Any] | None = None,
) -> AuditLog:
    ip, user_agent = client_meta(request)
    row = AuditLog(
        action=action,
        actor_user_id=actor.id if actor else None,
        actor_email=actor_email or (actor.email if actor else None),
        target_user_id=target_user_id,
        target_type=target_type,
        target_id=target_id,
        ip=ip,
        user_agent=user_agent,
        meta=meta or {},
    )
    db.add(row)
    return row
