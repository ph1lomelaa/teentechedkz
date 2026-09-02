"""Portal access provisioning: bridge a student card to a login account.

Staff (admin / mzk_manager / mentor-in-scope) grant, reset, and toggle a
student's portal account straight from the CRM student card. The generated
temp password is returned once for display; the student changes it on first
login (must_change_password).
"""
from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.security import hash_password
from app.services.mentor_scope import primary_mentor_id, require_student_access
from app.services.access_requests import decide, link_user_to_student
from app.services.audit import record_audit
from app.services.sessions import revoke_all_sessions
from app.services.invites import issue_invite, student_invite_url
from app.services.user_emails import MAX_EXTRA_EMAILS, email_in_use, list_extra_emails, norm
from app.models.access_request import STATUS_APPROVED, STATUS_NEW, AccessRequest
from app.models.audit_log import AuditAction
from app.models.student import Student
from app.models.user import User, UserRole
from app.models.user_email import UserEmail

router = APIRouter(prefix="/students", tags=["student-access"])

# Unambiguous alphabet (no O/0, I/l/1) for a readable temp password.
_PW_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


def _gen_password(length: int = 10) -> str:
    return "".join(secrets.choice(_PW_ALPHABET) for _ in range(length))


class GrantAccessRequest(BaseModel):
    email: EmailStr
    name: str | None = None  # defaults to the student's full name


class GrantAccessResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    name: str
    temp_password: str  # shown once in the CRM; also deliverable via Telegram later
    invite_url: str  # single-use link the student follows to set their own password
    invite_code: str  # short alphanumeric code for activation without a URL
    invite_expires_at: datetime


class ResetPasswordResponse(BaseModel):
    temp_password: str


class InviteResponse(BaseModel):
    invite_url: str
    invite_code: str
    invite_expires_at: datetime


class EmailEntry(BaseModel):
    id: uuid.UUID | None = None  # None for the primary (lives on users.email)
    email: str
    is_primary: bool
    is_verified: bool


class AccessStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    has_access: bool
    user_id: uuid.UUID | None = None
    email: str | None = None
    name: str | None = None
    is_active: bool | None = None
    must_change_password: bool | None = None
    last_login_at: datetime | None = None
    primary_mentor_id: uuid.UUID | None = None
    primary_mentor_name: str | None = None
    emails: list[EmailEntry] = []


class AddEmailRequest(BaseModel):
    email: EmailStr


class AccessToggleRequest(BaseModel):
    is_active: bool


async def _staff_student(
    db: AsyncSession, student_id: uuid.UUID, user: User
) -> Student:
    """Staff-only + mentor scope, then return the student or 404."""
    require_access(user, "student_access", Action.manage)
    await require_student_access(db, student_id, user)  # raises 404 for mentors out of scope
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    return student


async def _email_entries(db: AsyncSession, user: User) -> list[EmailEntry]:
    """Primary (from users.email, always trusted) + any extra addresses."""
    entries = [EmailEntry(id=None, email=user.email, is_primary=True, is_verified=True)]
    for ue in await list_extra_emails(db, user.id):
        entries.append(
            EmailEntry(id=ue.id, email=ue.email, is_primary=False, is_verified=ue.is_verified)
        )
    return entries


async def _full_access_status(db: AsyncSession, student: Student, user: User) -> AccessStatus:
    mentor_id = await primary_mentor_id(db, student.id)
    mentor = await db.get(User, mentor_id) if mentor_id else None
    return AccessStatus(
        has_access=True,
        user_id=user.id,
        email=user.email,
        name=user.name,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        primary_mentor_id=mentor.id if mentor else None,
        primary_mentor_name=mentor.name if mentor else None,
        emails=await _email_entries(db, user),
    )


@router.get("/{student_id}/access", response_model=AccessStatus)
async def get_access(
    student_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = await _staff_student(db, student_id, current_user)
    mentor_id = await primary_mentor_id(db, student_id)
    mentor = await db.get(User, mentor_id) if mentor_id else None
    if not student.user_id:
        return AccessStatus(
            has_access=False,
            primary_mentor_id=mentor.id if mentor else None,
            primary_mentor_name=mentor.name if mentor else None,
        )
    user = (await db.execute(select(User).where(User.id == student.user_id))).scalar_one_or_none()
    if not user:
        return AccessStatus(
            has_access=False,
            primary_mentor_id=mentor.id if mentor else None,
            primary_mentor_name=mentor.name if mentor else None,
        )
    return await _full_access_status(db, student, user)


@router.post("/{student_id}/grant-access", response_model=GrantAccessResponse, status_code=201)
async def grant_access(
    student_id: uuid.UUID,
    body: GrantAccessRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = await _staff_student(db, student_id, current_user)
    if student.user_id:
        raise HTTPException(status_code=409, detail="У студента уже есть доступ в кабинет")

    email = body.email.strip().lower()
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        # Раньше здесь был тупик: студент, зарегистрировавшийся сам через
        # Google, занимал email, и выдать ему кабинет становилось нечем —
        # ни этой ручкой, ни какой-либо другой. Теперь отказ машиночитаемый:
        # фронт показывает найденный аккаунт и предлагает привязать его
        # (POST /students/{id}/link-user) вместо создания второго.
        raise HTTPException(
            status_code=409,
            detail={
                "message": "У этого адреса уже есть аккаунт — его можно привязать к карточке",
                "user": {
                    "id": str(exists.id),
                    "name": exists.name,
                    "email": exists.email,
                    "is_active": exists.is_active,
                    "role": exists.role.value,
                },
            },
            headers={"X-Error-Code": "USER_EXISTS"},
        )

    temp_password = _gen_password()
    user = User(
        name=(body.name or student.full_name).strip(),
        email=email,
        hashed_password=hash_password(temp_password),
        role=UserRole.student,
        phone=student.phone,
        is_active=True,
        must_change_password=True,
    )
    db.add(user)
    await db.flush()  # assign user.id
    student.user_id = user.id

    invite, raw_token, raw_code = await issue_invite(
        db, user_id=user.id, student_id=student.id, created_by=current_user.id
    )
    record_audit(
        db,
        action=AuditAction.access_granted,
        actor=current_user,
        target_user_id=user.id,
        target_type="student",
        target_id=str(student.id),
        request=request,
        meta={"email": email},
    )
    record_audit(
        db,
        action=AuditAction.invite_created,
        actor=current_user,
        target_user_id=user.id,
        target_type="student",
        target_id=str(student.id),
        request=request,
        meta={"reason": "grant_access"},
    )
    await db.commit()

    # TODO (Phase 6): also deliver the invite link / temp password to the
    # student's Telegram once a telegram_id is linked to the portal account.
    return GrantAccessResponse(
        user_id=user.id,
        email=user.email,
        name=user.name,
        temp_password=temp_password,
        invite_url=student_invite_url(raw_token),
        invite_code=raw_code,
        invite_expires_at=invite.expires_at,
    )


class LinkUserRequest(BaseModel):
    user_id: uuid.UUID


@router.post("/{student_id}/link-user", response_model=AccessStatus, status_code=201)
async def link_existing_user(
    student_id: uuid.UUID,
    body: LinkUserRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Отдать кабинет этой карточки уже существующему аккаунту.

    Зачем отдельно от `grant_access`
    --------------------------------
    `grant_access` умеет только «завести нового пользователя», и на занятом
    email упирается в 409. Массовая самозапись делает этот случай основным:
    человек приходит через /join раньше, чем менеджер открывает его карточку.
    Привязка — вторая половина той же операции, и без неё зарегистрировавшийся
    сам ученик не получает кабинет никаким способом.

    Роль и связь ставятся вместе (`link_user_to_student`): `role=student` без
    `students.user_id` — это 404 на каждом экране портала.
    """
    student = await _staff_student(db, student_id, current_user)

    user = await db.get(User, body.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    await link_user_to_student(
        db,
        student=student,
        user=user,
        actor=current_user,
        request=request,
        via="link_user",
    )

    # Заявка этого человека, если он пришёл через /join, закрывается тем же
    # действием: иначе он останется висеть в очереди уже с выданным кабинетом.
    req = (
        await db.execute(select(AccessRequest).where(AccessRequest.user_id == user.id))
    ).scalar_one_or_none()
    if req is not None and req.status == STATUS_NEW:
        await decide(db, req=req, actor=current_user, status_value=STATUS_APPROVED)

    await db.commit()
    await db.refresh(user)
    return await _full_access_status(db, student, user)


@router.post("/{student_id}/invite", response_model=InviteResponse)
async def reissue_invite(
    student_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Issue a fresh single-use invite link for a student who already has an
    account — covers a lost or expired link. Supersedes any prior unused one."""
    student = await _staff_student(db, student_id, current_user)
    if not student.user_id:
        raise HTTPException(status_code=404, detail="У студента нет доступа в кабинет")

    invite, raw_token, raw_code = await issue_invite(
        db, user_id=student.user_id, student_id=student.id, created_by=current_user.id
    )
    record_audit(
        db,
        action=AuditAction.invite_created,
        actor=current_user,
        target_user_id=student.user_id,
        target_type="student",
        target_id=str(student.id),
        request=request,
        meta={"reason": "reissue"},
    )
    await db.commit()
    return InviteResponse(invite_url=student_invite_url(raw_token), invite_code=raw_code, invite_expires_at=invite.expires_at)


@router.post("/{student_id}/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    student_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = await _staff_student(db, student_id, current_user)
    if not student.user_id:
        raise HTTPException(status_code=404, detail="У студента нет доступа в кабинет")
    user = (await db.execute(select(User).where(User.id == student.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    temp_password = _gen_password()
    user.hashed_password = hash_password(temp_password)
    user.must_change_password = True
    # A staff reset invalidates any session the student still has open.
    revoked = await revoke_all_sessions(db, user.id)
    record_audit(
        db,
        action=AuditAction.password_reset,
        actor=current_user,
        target_user_id=user.id,
        target_type="student",
        target_id=str(student.id),
        request=request,
        meta={"sessions_revoked": revoked},
    )
    await db.commit()
    return ResetPasswordResponse(temp_password=temp_password)


@router.patch("/{student_id}/access", response_model=AccessStatus)
async def toggle_access(
    student_id: uuid.UUID,
    body: AccessToggleRequest,
    request: Request,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = await _staff_student(db, student_id, current_user)
    if not student.user_id:
        raise HTTPException(status_code=404, detail="У студента нет доступа в кабинет")
    user = (await db.execute(select(User).where(User.id == student.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    user.is_active = body.is_active
    # Deactivating access must also cut any live session immediately.
    revoked = 0
    if not body.is_active:
        revoked = await revoke_all_sessions(db, user.id)
    record_audit(
        db,
        action=AuditAction.access_toggled,
        actor=current_user,
        target_user_id=user.id,
        target_type="student",
        target_id=str(student.id),
        request=request,
        meta={"is_active": body.is_active, "sessions_revoked": revoked},
    )
    await db.commit()
    return await _full_access_status(db, student, user)


@router.post("/{student_id}/emails", response_model=AccessStatus, status_code=201)
async def add_email(
    student_id: uuid.UUID,
    body: AddEmailRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Add a second login email to a student's account (e.g. their personal
    address). Staff-entered, so it's trusted/verified immediately."""
    student = await _staff_student(db, student_id, current_user)
    if not student.user_id:
        raise HTTPException(status_code=404, detail="У студента нет доступа в кабинет")
    user = await db.get(User, student.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    email = norm(body.email)
    if email == user.email:
        raise HTTPException(status_code=409, detail="Это уже основной email аккаунта")
    if len(await list_extra_emails(db, user.id)) >= MAX_EXTRA_EMAILS:
        raise HTTPException(status_code=409, detail="Можно добавить только один дополнительный email")
    if await email_in_use(db, email):
        raise HTTPException(status_code=409, detail="Этот email уже используется")

    db.add(UserEmail(user_id=user.id, email=email, is_verified=True))
    await db.commit()
    return await _full_access_status(db, student, user)


@router.delete("/{student_id}/emails/{email_id}", response_model=AccessStatus)
async def remove_email(
    student_id: uuid.UUID,
    email_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = await _staff_student(db, student_id, current_user)
    if not student.user_id:
        raise HTTPException(status_code=404, detail="У студента нет доступа в кабинет")
    user = await db.get(User, student.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Аккаунт не найден")

    ue = await db.get(UserEmail, email_id)
    if not ue or ue.user_id != user.id:
        raise HTTPException(status_code=404, detail="Email не найден")
    await db.delete(ue)
    await db.commit()
    return await _full_access_status(db, student, user)
