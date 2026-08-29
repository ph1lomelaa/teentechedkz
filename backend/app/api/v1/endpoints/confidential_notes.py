from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.encryption import encrypt, decrypt
from app.models.confidential_note import ConfidentialNote, NoteVisibility, note_visible_to_role
from app.models.user import UserRole

router = APIRouter(prefix="/confidential-notes", tags=["confidential_notes"])


@router.get("/student/{student_id}")
async def get_notes(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "confidential_notes", Action.manage)
    result = await db.execute(
        select(ConfidentialNote)
        .where(ConfidentialNote.student_id == student_id)
        .order_by(ConfidentialNote.created_at)
    )
    notes = result.scalars().all()
    return [
        _note_to_dict(n) for n in notes
        if note_visible_to_role(n.visible_to_role, current_user.role)
    ]


@router.post("")
async def create_note(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "confidential_notes", Action.manage)
    note_text = body.get("note_text", "").strip()
    if not note_text:
        raise HTTPException(status_code=422, detail="note_text обязателен")

    try:
        visibility = NoteVisibility(body.get("visible_to_role", "admin_only"))
    except ValueError:
        visibility = NoteVisibility.admin_only

    note = ConfidentialNote(
        student_id=uuid.UUID(body["student_id"]),
        note_text_encrypted=encrypt(note_text),
        visible_to_role=visibility,
        created_by=current_user.id,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return _note_to_dict(note)


@router.patch("/{note_id}")
async def update_note(
    note_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Отредактировать текст/уровень видимости заметки (в т.ч. AI-извлечённой)."""
    require_access(current_user, "confidential_notes", Action.manage)
    result = await db.execute(select(ConfidentialNote).where(ConfidentialNote.id == note_id))
    note = result.scalar_one_or_none()
    if not note or not note_visible_to_role(note.visible_to_role, current_user.role):
        raise HTTPException(status_code=404, detail="Заметка не найдена")

    if "note_text" in body:
        note_text = str(body.get("note_text") or "").strip()
        if not note_text:
            raise HTTPException(status_code=422, detail="note_text обязателен")
        note.note_text_encrypted = encrypt(note_text)

    if "visible_to_role" in body:
        try:
            new_visibility = NoteVisibility(body["visible_to_role"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Некорректный visible_to_role")
        # Не даём сузить видимость до уровня, на котором сам редактор потеряет
        # доступ к заметке — иначе она "потеряется" для менеджера/ментора, который
        # только что её отредактировал.
        if not note_visible_to_role(new_visibility, current_user.role):
            raise HTTPException(
                status_code=422,
                detail="Нельзя выставить видимость, при которой заметка станет недоступна вам самим",
            )
        note.visible_to_role = new_visibility

    await db.commit()
    await db.refresh(note)
    return _note_to_dict(note)


@router.patch("/{note_id}/student-visibility")
async def set_student_visibility(
    note_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Publish/retract an important note into the student's portal «Заметки»
    section. Staff who can see the note (per role) can toggle it."""
    require_access(current_user, "confidential_notes", Action.manage)
    result = await db.execute(select(ConfidentialNote).where(ConfidentialNote.id == note_id))
    note = result.scalar_one_or_none()
    if not note or not note_visible_to_role(note.visible_to_role, current_user.role):
        raise HTTPException(status_code=404, detail="Заметка не найдена")
    note.visible_to_student = bool(body.get("visible_to_student"))
    await db.commit()
    await db.refresh(note)
    return _note_to_dict(note)


@router.delete("/{note_id}")
async def delete_note(
    note_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "confidential_notes", Action.manage)
    result = await db.execute(select(ConfidentialNote).where(ConfidentialNote.id == note_id))
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Заметка не найдена")
    if not note_visible_to_role(note.visible_to_role, current_user.role):
        raise HTTPException(status_code=404, detail="Заметка не найдена")
    await db.delete(note)
    await db.commit()
    return {"message": "Deleted"}


def _note_to_dict(n: ConfidentialNote) -> dict:
    plain = None
    if n.note_text_encrypted:
        try:
            plain = decrypt(n.note_text_encrypted)
        except Exception:
            plain = "[decrypt error]"
    return {
        "id": str(n.id),
        "student_id": str(n.student_id),
        "note_text": plain,
        "visible_to_role": n.visible_to_role.value,
        "visible_to_student": n.visible_to_student,
        "created_by": str(n.created_by),
        "created_at": n.created_at.isoformat(),
    }
