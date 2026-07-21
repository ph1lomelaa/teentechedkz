"""University portal credentials — login/password stored Fernet-encrypted.

Login is decrypted in list responses (safe to display); the password is only
returned by the explicit /reveal endpoint to the owner, an assigned mentor, or
an admin/manager. Students manage their own credentials from the portal.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.encryption import encrypt, decrypt
from app.services.mentor_scope import require_student_access
from app.models.student import Student
from app.models.user import UserRole
from app.models.credential import UniversityCredential
from app.schemas.university import CredentialOut, CredentialCreate, CredentialUpdate, CredentialReveal

router = APIRouter(tags=["credentials"])

STAFF = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_NOT_FOUND = HTTPException(status_code=404, detail="Учётные данные не найдены")


async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


async def _assert_manage(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    """Owner student or staff-in-scope may manage a student's credentials."""
    if user.role == UserRole.student:
        if await _my_student_id(db, user) != student_id:
            raise _NOT_FOUND
        return
    if user.role in STAFF:
        await require_student_access(db, student_id, user)
        return
    raise _FORBIDDEN


def _to_out(c: UniversityCredential) -> CredentialOut:
    try:
        login = decrypt(c.login_enc)
    except Exception:
        login = ""
    return CredentialOut(
        id=c.id, student_id=c.student_id, university_id=c.university_id,
        portal_name=c.portal_name, login=login, notes=c.notes,
        created_at=c.created_at, updated_at=c.updated_at,
    )


async def _list(db: AsyncSession, student_id: uuid.UUID) -> list[CredentialOut]:
    res = await db.execute(
        select(UniversityCredential).where(UniversityCredential.student_id == student_id).order_by(UniversityCredential.portal_name)
    )
    return [_to_out(c) for c in res.scalars().all()]


@router.get("/students/{student_id}/credentials", response_model=list[CredentialOut])
async def student_credentials(student_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    await _assert_manage(db, student_id, current_user)
    return await _list(db, student_id)


@router.get("/portal/credentials", response_model=list[CredentialOut])
async def my_credentials(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if current_user.role != UserRole.student:
        raise _FORBIDDEN
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    return await _list(db, sid)


@router.post("/credentials", response_model=CredentialOut, status_code=201)
async def create_credential(body: CredentialCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    # student → self; staff → body.student_id
    if current_user.role == UserRole.student:
        student_id = await _my_student_id(db, current_user)
        if not student_id:
            raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    else:
        if not body.student_id:
            raise HTTPException(status_code=422, detail="student_id обязателен")
        student_id = body.student_id
    await _assert_manage(db, student_id, current_user)

    cred = UniversityCredential(
        student_id=student_id, university_id=body.university_id, portal_name=body.portal_name,
        login_enc=encrypt(body.login), password_enc=encrypt(body.password), notes=body.notes,
    )
    db.add(cred)
    await db.commit()
    await db.refresh(cred)
    return _to_out(cred)


@router.patch("/credentials/{cred_id}", response_model=CredentialOut)
async def update_credential(cred_id: uuid.UUID, body: CredentialUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    cred = await db.get(UniversityCredential, cred_id)
    if not cred:
        raise _NOT_FOUND
    await _assert_manage(db, cred.student_id, current_user)
    data = body.model_dump(exclude_unset=True)
    if "login" in data:
        cred.login_enc = encrypt(data.pop("login"))
    if "password" in data:
        cred.password_enc = encrypt(data.pop("password"))
    for field, value in data.items():
        setattr(cred, field, value)
    await db.commit()
    await db.refresh(cred)
    return _to_out(cred)


@router.delete("/credentials/{cred_id}", status_code=204)
async def delete_credential(cred_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    cred = await db.get(UniversityCredential, cred_id)
    if not cred:
        raise _NOT_FOUND
    await _assert_manage(db, cred.student_id, current_user)
    await db.delete(cred)
    await db.commit()


@router.get("/credentials/{cred_id}/reveal", response_model=CredentialReveal)
async def reveal_credential(cred_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    cred = await db.get(UniversityCredential, cred_id)
    if not cred:
        raise _NOT_FOUND
    await _assert_manage(db, cred.student_id, current_user)
    try:
        password = decrypt(cred.password_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Не удалось расшифровать пароль")
    return CredentialReveal(password=password)
