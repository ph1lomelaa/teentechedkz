from __future__ import annotations
import secrets
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import uuid

from app.core.database import get_db
from app.core.security import hash_password
from app.core.deps import CurrentUser, AdminOnly
from app.core.permissions import Action, require_access
from app.models.agreement import Agreement, AgreementSignature, AgreementStatus
from app.models.user import User, UserRole
from app.services.agreements import audience_for_role
from app.services.invites import issue_invite, invite_url
from app.services.sessions import revoke_all_sessions

router = APIRouter(prefix="/users", tags=["users"])


async def _agreement_status_by_user(db: AsyncSession, users: list[User]) -> dict[uuid.UUID, dict]:
    """Колонка «Регламент» в SettingsUsersPage: без неё админ не понимает,
    почему ментор не работает (ОС 30/07, § 5.4)."""
    audiences = {audience_for_role(u.role) for u in users}
    audiences.discard(None)
    if not audiences:
        return {}

    published_result = await db.execute(
        select(Agreement).where(Agreement.audience.in_(audiences), Agreement.status == AgreementStatus.published)
    )
    published_by_audience: dict = {}
    for agreement in published_result.scalars().all():
        published_by_audience.setdefault(agreement.audience, []).append(agreement)

    user_ids = [u.id for u in users]
    signatures_result = await db.execute(
        select(
            AgreementSignature.user_id,
            AgreementSignature.agreement_id,
            AgreementSignature.agreement_version,
            AgreementSignature.signed_at,
        )
        .where(AgreementSignature.user_id.in_(user_ids))
    )
    signed_by_user: dict[uuid.UUID, dict[uuid.UUID, tuple[int, object]]] = {}
    for user_id, agreement_id, agreement_version, signed_at in signatures_result.all():
        signed_by_user.setdefault(user_id, {})[agreement_id] = (agreement_version, signed_at)

    statuses: dict[uuid.UUID, dict] = {}
    for u in users:
        if not u.is_active:
            statuses[u.id] = {"status": "suspended", "eligibility_state": "work_suspended"}
            continue
        audience = audience_for_role(u.role)
        published = published_by_audience.get(audience, [])
        if not published:
            statuses[u.id] = {"status": "not_applicable"}
            continue
        user_signatures = signed_by_user.get(u.id, {})
        unsigned = [a for a in published if (
            a.id not in user_signatures or user_signatures[a.id][0] != a.version
        )]
        if not unsigned:
            latest = max((user_signatures[a.id][1] for a in published), default=None)
            statuses[u.id] = {
                "status": "signed",
                "eligibility_state": "eligible_to_work",
                "signed_at": latest.isoformat() if latest else None,
            }
        else:
            has_expired_signature = any(
                a.id in user_signatures for a in unsigned
            )
            statuses[u.id] = {
                "status": "pending",
                "eligibility_state": "agreement_expired" if has_expired_signature else "agreement_required",
                "pending_agreements": [a.title for a in unsigned],
            }
    return statuses


@router.get("")
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    role: str | None = None,
    is_active: bool | None = None,
):
    require_access(current_user, "users", Action.view)

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
    agreement_statuses = await _agreement_status_by_user(db, users)
    return [_user_to_dict(u, agreement_status=agreement_statuses.get(u.id)) for u in users]


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


@router.post("/invite", dependencies=[AdminOnly])
async def create_user_invite(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Create a staff account (mentor/manager/admin) without a password and hand
    back a single-use invite link — the invitee sets their own password, exactly
    like a student (п.7). The account stays inactive until the invite is accepted."""
    email = body.get("email", "").strip().lower()
    if not email:
        raise HTTPException(status_code=422, detail="Email обязателен")
    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email уже занят")

    try:
        role = UserRole(body.get("role", "mentor"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверная роль")
    if role == UserRole.student:
        raise HTTPException(status_code=422, detail="Ученику доступ выдаётся из карточки студента")

    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="Имя обязательно")

    user = User(
        name=name,
        email=email,
        # Placeholder secret so the row is never login-able until the invite is
        # accepted (which replaces it with the user's own password).
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        role=role,
        phone=body.get("phone"),
        is_active=False,
        must_change_password=False,
    )
    db.add(user)
    await db.flush()
    invite, raw_token, raw_code = await issue_invite(
        db, user_id=user.id, student_id=None, created_by=current_user.id
    )
    await db.commit()
    await db.refresh(user)
    return {
        **_user_to_dict(user),
        "invite_url": invite_url(raw_token),
        "invite_code": raw_code,
        "invite_expires_at": invite.expires_at.isoformat(),
    }


@router.get("/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "users", Action.view)

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

    is_self = user_id == current_user.id
    revoke_sessions = False
    if is_self and body.get("is_active") is False:
        raise HTTPException(status_code=400, detail="Нельзя деактивировать самого себя")

    if "name" in body:
        user.name = body["name"].strip()
    if "role" in body:
        if is_self:
            raise HTTPException(status_code=400, detail="Нельзя менять собственную роль — попросите другого администратора")
        try:
            new_role = UserRole(body["role"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная роль")
        if new_role != user.role:
            user.role = new_role
            # A role change invalidates whatever the client believes it can do —
            # force a fresh login so the session picks up the new permissions.
            revoke_sessions = True
    if "phone" in body:
        user.phone = body["phone"]
    if "telegram_username" in body:
        user.telegram_username = body["telegram_username"]
    if "telegram_id" in body:
        user.telegram_id = body["telegram_id"]
    if "is_active" in body:
        user.is_active = body["is_active"]
        if not user.is_active:
            revoke_sessions = True
    if "password" in body:
        p = body["password"]
        if len(p) < 8:
            raise HTTPException(status_code=422, detail="Пароль минимум 8 символов")
        user.hashed_password = hash_password(p)
        user.must_change_password = True
        revoke_sessions = True

    if revoke_sessions:
        await revoke_all_sessions(db, user.id)

    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


@router.delete("/{user_id}", dependencies=[AdminOnly])
async def deactivate_user(
    user_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Нельзя деактивировать самого себя")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    user.is_active = False
    await revoke_all_sessions(db, user.id)
    await db.commit()
    return {"message": "Пользователь деактивирован"}


def _user_to_dict(u: User, agreement_status: dict | None = None) -> dict:
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
        "agreement_status": agreement_status or {"status": "not_applicable"},
    }
