"""Public (unauthenticated) invite acceptance (Приоритет 1).

The student arrives here holding a one-time token from their invite link:
GET validates it and shows whom it's for; POST sets the permanent password and
burns the link. Rate-limited by IP as defence-in-depth against token guessing.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.audit_log import AuditAction
from app.models.user import User
from app.services import rate_limit
from app.services.audit import record_audit
from app.services.invites import accept_invite, resolve_valid_invite

router = APIRouter(prefix="/public/invite", tags=["public"])


class InviteInfo(BaseModel):
    valid: bool
    name: str | None = None
    email: str | None = None


class AcceptInviteRequest(BaseModel):
    password: str


@router.get("/{token}", response_model=InviteInfo)
async def get_invite(
    token: str,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await rate_limit.enforce(request, bucket="invite", limit=30, window_seconds=300)
    invite = await resolve_valid_invite(db, raw_token=token)
    if not invite:
        return InviteInfo(valid=False)
    user = await db.get(User, invite.user_id)
    if not user:
        return InviteInfo(valid=False)
    return InviteInfo(valid=True, name=user.name, email=user.email)


@router.post("/{token}/accept")
async def accept(
    token: str,
    body: AcceptInviteRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await rate_limit.enforce(request, bucket="invite", limit=30, window_seconds=300)

    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Пароль должен быть минимум 8 символов")

    invite = await resolve_valid_invite(db, raw_token=token)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Ссылка недействительна или уже использована. Запросите новую у менеджера.",
            headers={"X-Error-Code": "INVITE_INVALID"},
        )

    user = await accept_invite(db, invite, body.password)
    record_audit(
        db,
        action=AuditAction.invite_accepted,
        actor=user,
        target_user_id=user.id,
        target_type="student",
        target_id=str(invite.student_id) if invite.student_id else None,
        request=request,
    )
    await db.commit()
    return {"message": "Пароль установлен. Теперь можно войти.", "email": user.email}


@router.post("/{code}/accept-code")
async def accept_by_code(
    code: str,
    body: AcceptInviteRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Accept an invite using a short activation code instead of a URL token.
    Rate-limited by IP."""
    await rate_limit.enforce(request, bucket="invite", limit=30, window_seconds=300)

    if len(body.password) < 8:
        raise HTTPException(status_code=422, detail="Пароль должен быть минимум 8 символов")

    invite = await resolve_valid_invite(db, raw_code=code)
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Код недействителен или уже использован. Запросите новый у менеджера.",
            headers={"X-Error-Code": "INVITE_INVALID"},
        )

    user = await accept_invite(db, invite, body.password)
    record_audit(
        db,
        action=AuditAction.invite_accepted,
        actor=user,
        target_user_id=user.id,
        target_type="student",
        target_id=str(invite.student_id) if invite.student_id else None,
        request=request,
        meta={"method": "code"},
    )
    await db.commit()
    return {"message": "Пароль установлен. Теперь можно войти.", "email": user.email}
