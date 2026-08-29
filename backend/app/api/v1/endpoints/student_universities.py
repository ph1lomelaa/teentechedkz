"""Student university shortlist — «избранные вузы».

Managed jointly by the student and their staff (admin / mzk_manager / assigned
mentor), so the access rules mirror university_credentials exactly: the owner
student, or staff whose scope covers that student. The dual-endpoint split is
the same idiom — /portal/... always resolves to the caller's own student row,
/students/{id}/... is the staff view.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser, CurrentStudent
from app.core.permissions import Action, require_access
from app.models.student import Student
from app.models.student_university import StudentUniversity
from app.models.university import University
from app.models.user import UserRole
from app.schemas.student_university import ShortlistItemOut, ShortlistCreate, ShortlistUpdate
from app.services.country_flags import attach_flags
from app.services.mentor_scope import require_student_access
from app.services.notify import notify, push_notification

router = APIRouter(tags=["student_universities"])

_NOT_FOUND = HTTPException(status_code=404, detail="Запись не найдена")


async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


async def _assert_manage(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    """Owner student or staff-in-scope may manage a student's shortlist."""
    require_access(user, "student_universities", Action.manage)
    if user.role == UserRole.student:
        if await _my_student_id(db, user) != student_id:
            raise _NOT_FOUND
        return
    await require_student_access(db, student_id, user)


def _sort_key(item: StudentUniversity):
    """priority ascending with NULLs last, then oldest first.

    Done in Python rather than SQL so the rule is unit-testable and identical
    everywhere the list is built.
    """
    return (item.priority is None, item.priority if item.priority is not None else 0, item.created_at)


async def _list(db: AsyncSession, student_id: uuid.UUID) -> list[ShortlistItemOut]:
    res = await db.execute(
        select(StudentUniversity).where(StudentUniversity.student_id == student_id)
    )
    items = sorted(res.scalars().unique().all(), key=_sort_key)
    await attach_flags(db, [i.university for i in items])
    return [
        ShortlistItemOut(
            id=i.id,
            student_id=i.student_id,
            university_id=i.university_id,
            note=i.note,
            priority=i.priority,
            added_by_user_id=i.added_by_user_id,
            added_by_role=i.added_by_role,
            added_by_name=i.added_by.name if i.added_by else None,
            created_at=i.created_at,
            university=i.university,
        )
        for i in items
    ]


@router.get("/students/{student_id}/shortlist", response_model=list[ShortlistItemOut])
async def student_shortlist(
    student_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]
):
    await _assert_manage(db, student_id, current_user)
    return await _list(db, student_id)


@router.get("/portal/shortlist", response_model=list[ShortlistItemOut])
async def my_shortlist(student: CurrentStudent, db: Annotated[AsyncSession, Depends(get_db)]):
    return await _list(db, student.id)


@router.post("/student-universities", response_model=ShortlistItemOut, status_code=201)
async def add_to_shortlist(
    body: ShortlistCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]
):
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

    university = await db.get(University, body.university_id)
    if not university:
        raise HTTPException(status_code=404, detail="Университет не найден")

    item = StudentUniversity(
        student_id=student_id,
        university_id=body.university_id,
        added_by_user_id=current_user.id,
        added_by_role=current_user.role.value,
        note=body.note,
        priority=body.priority,
    )
    db.add(item)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Этот вуз уже в избранном")

    # Tell the student when staff picked a university for them (never on their
    # own action, and only if the card has a portal account at all).
    note = None
    if current_user.role != UserRole.student:
        student = await db.get(Student, student_id)
        if student and student.user_id:
            note = notify(
                db,
                student.user_id,
                kind="shortlist_suggested",
                title="Ментор добавил вуз в избранное",
                body=f"{university.name} [shortlist:{item.id}]",
                link="/portal/shortlist",
            )

    await db.commit()
    await db.refresh(item)
    if note is not None:
        await db.refresh(note)
        await push_notification(note)

    await attach_flags(db, item.university)
    return ShortlistItemOut(
        id=item.id,
        student_id=item.student_id,
        university_id=item.university_id,
        note=item.note,
        priority=item.priority,
        added_by_user_id=item.added_by_user_id,
        added_by_role=item.added_by_role,
        added_by_name=current_user.name,
        created_at=item.created_at,
        university=item.university,
    )


@router.patch("/student-universities/{item_id}", response_model=ShortlistItemOut)
async def update_shortlist_item(
    item_id: uuid.UUID,
    body: ShortlistUpdate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    item = await db.get(StudentUniversity, item_id)
    if not item:
        raise _NOT_FOUND
    await _assert_manage(db, item.student_id, current_user)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    await db.commit()
    await db.refresh(item)

    await attach_flags(db, item.university)
    return ShortlistItemOut(
        id=item.id,
        student_id=item.student_id,
        university_id=item.university_id,
        note=item.note,
        priority=item.priority,
        added_by_user_id=item.added_by_user_id,
        added_by_role=item.added_by_role,
        added_by_name=item.added_by.name if item.added_by else None,
        created_at=item.created_at,
        university=item.university,
    )


@router.delete("/student-universities/{item_id}", status_code=204)
async def remove_from_shortlist(
    item_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]
):
    item = await db.get(StudentUniversity, item_id)
    if not item:
        raise _NOT_FOUND
    await _assert_manage(db, item.student_id, current_user)
    await db.delete(item)
    await db.commit()
