from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.deps import CurrentUser
from app.core.database import get_db
from app.core.encryption import decrypt, encrypt
from app.models.communication_log import CommunicationLog, CommSource, MessageType
from app.models.confidential_note import ConfidentialNote, default_note_visibility_for, is_near_duplicate_note
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.user import UserRole
from app.schemas.student_note import (
    StudentNoteCreate,
    StudentNoteImportanceRequest,
    StudentNotePublishRequest,
    StudentNoteResponse,
    StudentNoteReviewRequest,
)
from app.services.note_blocks import block_headings
from app.services.note_sessions import reformulate_for_student
from app.services.student_notes import (
    apply_student_updates,
    build_profile_diff,
    build_summary_markdown,
    parse_suggested_changes,
    render_change_preview,
    snapshot_student,
)


router = APIRouter(prefix="/notes", tags=["notes"])


async def _mentor_student_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    from app.models.mentor_assignment import MentorAssignment

    result = await db.execute(
        select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == user_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
    )
    return {row[0] for row in result.all()}


def _is_staff_admin(current_user) -> bool:
    return current_user.role in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)


async def _load_accessible_student(db: AsyncSession, current_user, student_id: uuid.UUID) -> Student:
    result = await db.execute(select(Student).where(Student.id == student_id, Student.is_archived == False))  # noqa: E712
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    if _is_staff_admin(current_user):
        return student

    mentor_ids = await _mentor_student_ids(db, current_user.id)
    if student_id not in mentor_ids:
        raise HTTPException(status_code=403, detail="Access denied")
    return student


def _note_to_response(note: StudentNote, student_name: str | None = None) -> StudentNoteResponse:
    return StudentNoteResponse(
        id=note.id,
        student_id=note.student_id,
        student_name=student_name,
        title=note.title,
        source_text=note.source_text,
        summary_markdown=note.summary_markdown,
        student_summary_markdown=note.student_summary_markdown,
        profile_snapshot=note.profile_snapshot or {},
        suggested_changes=note.suggested_changes or {},
        applied_changes=note.applied_changes or {},
        status=note.status,
        created_by=note.created_by,
        reviewed_by=note.reviewed_by,
        created_at=note.created_at,
        reviewed_at=note.reviewed_at,
        published_to_student=note.published_to_student,
        published_at=note.published_at,
        student_title=note.student_title,
        hidden_blocks=note.hidden_blocks or [],
        # Toggleable blocks reflect whichever text the student actually reads.
        blocks=block_headings(note.student_summary_markdown or note.summary_markdown),
        is_important=note.is_important,
        source_kind=note.source_kind,
    )


@router.get("", response_model=list[StudentNoteResponse])
async def list_notes(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_id: uuid.UUID | None = None,
    status: StudentNoteStatus | None = None,
    scope: str = "all",
):
    query = select(StudentNote, Student.full_name).outerjoin(Student, Student.id == StudentNote.student_id)
    if student_id:
        query = query.where(StudentNote.student_id == student_id)

    mentor_ids: set[uuid.UUID] | None = None
    if scope == "mine":
        mentor_ids = await _mentor_student_ids(db, current_user.id)
        if mentor_ids:
            query = query.where(StudentNote.student_id.in_(mentor_ids))
        else:
            query = query.where(StudentNote.student_id.is_(None) & (StudentNote.created_by == current_user.id))
    elif scope != "all":
        raise HTTPException(status_code=422, detail="Неверный scope")

    if not _is_staff_admin(current_user):
        if mentor_ids is None:
            mentor_ids = await _mentor_student_ids(db, current_user.id)
        if mentor_ids:
            query = query.where(
                (StudentNote.student_id.is_(None) & (StudentNote.created_by == current_user.id))
                | StudentNote.student_id.in_(mentor_ids)
            )
        else:
            query = query.where(
                StudentNote.student_id.is_(None) & (StudentNote.created_by == current_user.id)
            )

    if status:
        query = query.where(StudentNote.status == status)

    result = await db.execute(query.order_by(StudentNote.created_at.desc()))
    rows = result.all()
    return [
        _note_to_response(note, student_name)
        for note, student_name in rows
    ]


@router.get("/{note_id}", response_model=StudentNoteResponse)
async def get_note(
    note_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(StudentNote, Student.full_name)
        .outerjoin(Student, Student.id == StudentNote.student_id)
        .where(StudentNote.id == note_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Конспект не найден")
    note, student_name = row

    if note.student_id and not _is_staff_admin(current_user):
        mentor_ids = await _mentor_student_ids(db, current_user.id)
        if note.student_id not in mentor_ids:
            raise HTTPException(status_code=403, detail="Access denied")
    elif not note.student_id and note.created_by != current_user.id and not _is_staff_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    return _note_to_response(note, student_name)


@router.post("", response_model=StudentNoteResponse, status_code=201)
async def create_note(
    body: StudentNoteCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = None
    snapshot = {}
    if body.student_id:
        student = await _load_accessible_student(db, current_user, body.student_id)
        snapshot = snapshot_student(student)

    suggested_changes = parse_suggested_changes(body.suggested_changes, body.source_text)
    summary_markdown = body.summary_markdown or build_summary_markdown(
        body.title,
        body.source_text,
        snapshot,
        suggested_changes,
    )

    note = StudentNote(
        student_id=body.student_id,
        title=body.title.strip(),
        source_text=body.source_text.strip(),
        summary_markdown=summary_markdown,
        student_summary_markdown=body.student_summary_markdown,
        profile_snapshot=snapshot,
        suggested_changes=suggested_changes,
        applied_changes={},
        status=StudentNoteStatus.draft,
        created_by=current_user.id,
        reviewed_by=None,
        created_at=datetime.now(timezone.utc),
        is_important=body.is_important,
        source_kind=body.source_kind,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student.full_name if student else None)


@router.patch("/{note_id}/importance", response_model=StudentNoteResponse)
async def set_note_importance(
    note_id: uuid.UUID,
    body: StudentNoteImportanceRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(StudentNote, Student.full_name)
        .outerjoin(Student, Student.id == StudentNote.student_id)
        .where(StudentNote.id == note_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Заметка не найдена")
    note, student_name = row
    if note.student_id:
        await _load_accessible_student(db, current_user, note.student_id)
    elif note.created_by != current_user.id and not _is_staff_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    note.is_important = body.is_important
    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student_name)


@router.delete("/{note_id}")
async def delete_note(
    note_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    note = await db.get(StudentNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Конспект не найден")

    if note.student_id and not _is_staff_admin(current_user):
        mentor_ids = await _mentor_student_ids(db, current_user.id)
        if note.student_id not in mentor_ids:
            raise HTTPException(status_code=403, detail="Access denied")
    elif not note.student_id and note.created_by != current_user.id and not _is_staff_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    await db.delete(note)
    await db.commit()
    return {"ok": True}


@router.post("/{note_id}/review", response_model=StudentNoteResponse)
async def review_note(
    note_id: uuid.UUID,
    body: StudentNoteReviewRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(StudentNote, Student.full_name)
        .outerjoin(Student, Student.id == StudentNote.student_id)
        .where(StudentNote.id == note_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Конспект не найден")
    note, student_name = row

    action = body.action.lower().strip()
    if action not in {"approve", "reject"}:
        raise HTTPException(status_code=422, detail="action должен быть approve или reject")
    if note.status != StudentNoteStatus.draft:
        raise HTTPException(status_code=409, detail="Конспект уже проверен")

    if action == "approve":
        if body.summary_markdown is not None:
            summary_markdown = body.summary_markdown.strip()
            if summary_markdown:
                note.summary_markdown = summary_markdown
        if body.student_summary_markdown is not None:
            student_summary_markdown = body.student_summary_markdown.strip()
            if student_summary_markdown:
                note.student_summary_markdown = student_summary_markdown
        if body.suggested_changes is not None:
            note.suggested_changes = dict(body.suggested_changes)

    note.reviewed_by = current_user.id
    note.reviewed_at = datetime.now(timezone.utc)

    if action == "reject":
        note.status = StudentNoteStatus.rejected
        await db.commit()
        await db.refresh(note)
        return _note_to_response(note, student_name)

    applied_changes: list[dict] = []
    saved_profile_notes = 0
    if note.student_id:
        student = await _load_accessible_student(db, current_user, note.student_id)
        applied_changes = apply_student_updates(student, note.suggested_changes or {})
        if applied_changes:
            for change in applied_changes:
                await log_change(
                    db,
                    "student",
                    student.id,
                    change["field"],
                    change["old_value"],
                    change["new_value"],
                    str(current_user.id),
                    source="student_note",
                )
            student.updated_at = datetime.now(timezone.utc)

        # Важные факты, не ложащиеся в поля профиля, — в заметки студента
        # (видимость admin+mzk, как у ручных заметок на карточке)
        profile_notes = (note.suggested_changes or {}).get("profile_notes") or []
        if profile_notes:
            existing_result = await db.execute(
                select(ConfidentialNote.note_text_encrypted)
                .where(ConfidentialNote.student_id == student.id)
                .order_by(ConfidentialNote.created_at.desc())
                .limit(50)
            )
            existing_notes = []
            for (encrypted,) in existing_result.all():
                if not encrypted:
                    continue
                try:
                    existing_notes.append(decrypt(encrypted))
                except Exception:
                    continue
        for text in profile_notes:
            if not isinstance(text, str) or not text.strip():
                continue
            text = text.strip()
            if is_near_duplicate_note(text, existing_notes):
                continue
            db.add(
                ConfidentialNote(
                    student_id=student.id,
                    note_text_encrypted=encrypt(f"Из конспекта «{note.title}»: {text}"[:4000]),
                    visible_to_role=default_note_visibility_for(current_user.role),
                    created_by=current_user.id,
                )
            )
            existing_notes.append(text)
            saved_profile_notes += 1
        if saved_profile_notes:
            await log_change(
                db, "student", student.id, "profile_notes_from_note",
                None, f"{saved_profile_notes} заметок из «{note.title}»",
                str(current_user.id), "student_note",
            )

        db.add(
            CommunicationLog(
                student_id=student.id,
                source=CommSource.manual,
                message_type=MessageType.call_transcript,
                raw_text=note.source_text,
                ai_summary=note.summary_markdown,
                zoom_call_date=None,
                zoom_duration_min=None,
            )
        )

    note.status = StudentNoteStatus.approved
    note.applied_changes = {"changes": applied_changes, "profile_notes_saved": saved_profile_notes}

    # Approving no longer auto-publishes — sending to the student is now a
    # separate, explicit action (POST /notes/{id}/publish), since every note
    # now carries its own student-facing reformulation the mentor may want to
    # review before it reaches the portal.
    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student_name)


async def _load_note_in_scope(db: AsyncSession, current_user, note_id: uuid.UUID):
    """Load a note with its student name, enforcing staff/mentor scope."""
    result = await db.execute(
        select(StudentNote, Student.full_name)
        .outerjoin(Student, Student.id == StudentNote.student_id)
        .where(StudentNote.id == note_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Конспект не найден")
    note, student_name = row
    if note.student_id and not _is_staff_admin(current_user):
        mentor_ids = await _mentor_student_ids(db, current_user.id)
        if note.student_id not in mentor_ids:
            raise HTTPException(status_code=403, detail="Access denied")
    elif not note.student_id and note.created_by != current_user.id and not _is_staff_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")
    return note, student_name


async def _notify_student_note_published(db: AsyncSession, note: StudentNote) -> None:
    """Publishing a note used to be silent — the student only found out by
    happening to open «Конспекты». Mirrors the Notification pattern already
    used for new tasks/meetings elsewhere in the app."""
    from app.models.notification import Notification

    if not note.student_id:
        return
    student = await db.get(Student, note.student_id)
    if not student or not student.user_id:
        return
    db.add(Notification(
        user_id=student.user_id,
        kind="note_published",
        title="Новый конспект",
        body=note.student_title or note.title,
        link="/portal/notes",
        priority="normal",
    ))


@router.post("/{note_id}/publish", response_model=StudentNoteResponse)
async def publish_note(
    note_id: uuid.UUID,
    body: StudentNotePublishRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Make a reviewed конспект visible in the student's portal. Only approved
    notes tied to a student can be published; the manager may set a personal
    heading and hide individual blocks."""
    note, student_name = await _load_note_in_scope(db, current_user, note_id)
    if not note.student_id:
        raise HTTPException(status_code=422, detail="Конспект не привязан к студенту")
    if note.status != StudentNoteStatus.approved:
        raise HTTPException(
            status_code=409, detail="Опубликовать можно только проверенный конспект"
        )

    note.published_to_student = True
    note.published_at = datetime.now(timezone.utc)
    note.published_by = current_user.id
    if body.student_title is not None:
        note.student_title = body.student_title.strip() or None
    if body.hidden_blocks is not None:
        note.hidden_blocks = list(body.hidden_blocks)
    await _notify_student_note_published(db, note)
    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student_name)


@router.post("/{note_id}/unpublish", response_model=StudentNoteResponse)
async def unpublish_note(
    note_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Retract a конспект from the student's portal."""
    note, student_name = await _load_note_in_scope(db, current_user, note_id)
    note.published_to_student = False
    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student_name)


@router.post("/{note_id}/regenerate-student-summary", response_model=StudentNoteResponse)
async def regenerate_student_summary(
    note_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Re-reword the student-facing text from the current (possibly hand-
    edited) mentor summary — available regardless of status so a mentor can
    touch it before or after approval/publish."""
    note, student_name = await _load_note_in_scope(db, current_user, note_id)
    note.student_summary_markdown = await reformulate_for_student(note.summary_markdown, student_name)
    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student_name)


@router.get("/{note_id}/diff")
async def note_diff(
    note_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(StudentNote, Student.full_name)
        .outerjoin(Student, Student.id == StudentNote.student_id)
        .where(StudentNote.id == note_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Конспект не найден")
    note, student_name = row
    if note.student_id and not _is_staff_admin(current_user):
        mentor_ids = await _mentor_student_ids(db, current_user.id)
        if note.student_id not in mentor_ids:
            raise HTTPException(status_code=403, detail="Access denied")
    elif not note.student_id and note.created_by != current_user.id and not _is_staff_admin(current_user):
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "note_id": str(note.id),
        "student_name": student_name,
        "student_id": str(note.student_id) if note.student_id else None,
        "snapshot": note.profile_snapshot or {},
        "suggested_changes": note.suggested_changes or {},
        "preview": render_change_preview(note.profile_snapshot or {}, note.suggested_changes or {}),
        "diff": build_profile_diff(note.profile_snapshot or {}, note.suggested_changes or {}),
    }
