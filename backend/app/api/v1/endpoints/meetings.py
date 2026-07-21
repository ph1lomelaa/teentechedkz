"""Meetings between a student and their mentor (calendar).

Staff (admin, mzk_manager, mentor-in-scope) schedule and manage meetings from the
CRM card; the student sees them in the portal with join links and, for past
meetings, recording/transcript links.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.services.ai_client import complete_with_fallback, provider_chain
from app.services.mentor_scope import ensure_lead_assignment, primary_mentor_id, require_student_access
from app.services.note_sessions import generate_note_draft
from app.services.student_notes import snapshot_student
from app.models.student import Student
from app.models.user import UserRole
from app.models.meeting import Meeting
from app.models.chat import Conversation, ConversationMember, ConversationType, Message
from app.models.notification import Notification
from app.models.note_session import NoteSession, NoteSessionStatus
from app.models.note_transcript import NoteTranscript
from app.models.student_note import StudentNote, StudentNoteStatus
from app.schemas.meeting import MeetingOut, MeetingCreate, MeetingUpdate
from app.schemas.student_note import StudentNoteResponse
from app.services.ws_hub import manager

router = APIRouter(tags=["meetings"])

STAFF = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_NOT_FOUND = HTTPException(status_code=404, detail="Встреча не найдена")

FOLLOW_UP_SYSTEM = """Ты помощник менеджера образовательной платформы.
Составь короткое follow-up сообщение студенту или родителю после звонка.
Пиши по-русски, вежливо, конкретно, без выдуманных фактов.
Не обещай того, чего нет в исходных данных.
Формат: только текст сообщения, без markdown, без пояснений."""


class SendFollowUpBody(BaseModel):
    message: str


def _note_to_response(note: StudentNote, student_name: str | None = None) -> StudentNoteResponse:
    return StudentNoteResponse(
        id=note.id,
        student_id=note.student_id,
        student_name=student_name,
        title=note.title,
        source_text=note.source_text,
        summary_markdown=note.summary_markdown,
        profile_snapshot=note.profile_snapshot or {},
        suggested_changes=note.suggested_changes or {},
        applied_changes=note.applied_changes or {},
        status=note.status,
        created_by=note.created_by,
        reviewed_by=note.reviewed_by,
        created_at=note.created_at,
        reviewed_at=note.reviewed_at,
    )


async def _meeting_source_text(db: AsyncSession, meeting: Meeting) -> str:
    transcript_lines: list[str] = []
    session = meeting.note_session
    if session:
        transcript_result = await db.execute(
            select(NoteTranscript)
            .where(NoteTranscript.session_id == session.id)
            .order_by(NoteTranscript.sequence_no.asc(), NoteTranscript.id.asc())
        )
        transcripts = list(transcript_result.scalars())
        transcript_lines.extend(
            f"[{row.speaker}]: {row.text}" if row.speaker else row.text
            for row in transcripts
            if row.text and row.text.strip()
        )
        if session.backup_transcript_text and session.backup_transcript_text.strip():
            transcript_lines.append(f"Backup transcript:\n{session.backup_transcript_text.strip()}")

    source_parts = [
        f"Тип звонка: {meeting.meeting_type.value}",
        f"Тема: {meeting.title}",
        f"Дата: {meeting.starts_at.isoformat()}",
    ]
    if meeting.description.strip():
        source_parts.append(f"Повестка:\n{meeting.description.strip()}")
    if meeting.outcome.strip():
        source_parts.append(f"Итог звонка:\n{meeting.outcome.strip()}")
    if transcript_lines:
        source_parts.append("Транскрипт:\n" + "\n".join(transcript_lines))
    return "\n\n".join(source_parts).strip()


def _fallback_follow_up(meeting: Meeting, student_name: str | None, source_text: str) -> str:
    name = student_name or "добрый день"
    intro = f"Здравствуйте, {name}!"
    if meeting.outcome.strip():
        body = f"Спасибо за звонок. Коротко фиксирую итог: {meeting.outcome.strip()}"
    elif meeting.description.strip():
        body = f"Спасибо за звонок. Мы обсудили: {meeting.description.strip()}"
    else:
        body = f"Спасибо за звонок по теме «{meeting.title}»."
    next_step = "Если я что-то упустил(а), напишите мне, пожалуйста, и я поправлю план действий."
    if not source_text:
        next_step = "Я дополню сообщение после фиксации итогов звонка."
    return f"{intro}\n\n{body}\n\n{next_step}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


async def _member_ids(db: AsyncSession, conv_id: uuid.UUID) -> list[uuid.UUID]:
    res = await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conv_id))
    return [r[0] for r in res.all()]


async def _get_or_create_direct(db: AsyncSession, a: uuid.UUID, b: uuid.UUID, created_by: uuid.UUID) -> Conversation:
    key = ":".join(sorted([str(a), str(b)]))
    res = await db.execute(select(Conversation).where(Conversation.direct_key == key))
    conv = res.scalar_one_or_none()
    if conv:
        return conv
    conv = Conversation(type=ConversationType.direct, direct_key=key, created_by=created_by)
    conv.members = [ConversationMember(user_id=a), ConversationMember(user_id=b)]
    db.add(conv)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        res = await db.execute(select(Conversation).where(Conversation.direct_key == key))
        conv = res.scalar_one_or_none()
        if not conv:
            raise
    return conv


async def _send_chat_message(db: AsyncSession, conv: Conversation, sender, text: str, notification_link: str) -> Message:
    msg = Message(conversation_id=conv.id, sender_id=sender.id, body=text)
    db.add(msg)
    await db.flush()
    await db.execute(
        ConversationMember.__table__.update()
        .where(and_(ConversationMember.conversation_id == conv.id, ConversationMember.user_id == sender.id))
        .values(last_read_at=_now())
    )

    member_ids = await _member_ids(db, conv.id)
    preview = text if len(text) <= 80 else text[:77] + "…"
    for uid in member_ids:
        if uid == sender.id:
            continue
        db.add(Notification(
            user_id=uid,
            kind="message",
            title=f"Сообщение от {sender.name}",
            body=preview,
            link=notification_link,
        ))
    await db.commit()
    await db.refresh(msg)

    payload = {
        "conversation_id": str(conv.id),
        "message": {"id": str(msg.id), "sender_id": str(sender.id), "body": msg.body, "created_at": msg.created_at.isoformat()},
    }
    await manager.send_to_users([str(m) for m in member_ids], "message.new", payload)
    return msg


async def _assert_view(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    if user.role == UserRole.student:
        if await _my_student_id(db, user) != student_id:
            raise _NOT_FOUND
        return
    if user.role in STAFF:
        await require_student_access(db, student_id, user)
        return
    raise _FORBIDDEN


async def _assert_staff(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    if user.role not in STAFF:
        raise _FORBIDDEN
    await require_student_access(db, student_id, user)


async def _list(db: AsyncSession, student_id: uuid.UUID) -> list[Meeting]:
    res = await db.execute(
        select(Meeting)
        .options(selectinload(Meeting.note_session))
        .where(Meeting.student_id == student_id)
        .order_by(Meeting.starts_at.asc())
    )
    return list(res.scalars().all())


@router.get("/students/{student_id}/meetings", response_model=list[MeetingOut])
async def student_meetings(student_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    await _assert_view(db, student_id, current_user)
    return await _list(db, student_id)


@router.get("/portal/meetings", response_model=list[MeetingOut])
async def my_meetings(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if current_user.role != UserRole.student:
        raise _FORBIDDEN
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    return await _list(db, sid)


@router.post("/meetings", response_model=MeetingOut, status_code=201)
async def create_meeting(body: MeetingCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    await _assert_staff(db, body.student_id, current_user)
    mentor_id = body.mentor_id
    if mentor_id is None and current_user.role == UserRole.mentor:
        mentor_id = current_user.id
    if mentor_id is None:
        mentor_id = await primary_mentor_id(db, body.student_id)
    if mentor_id is not None:
        await ensure_lead_assignment(db, body.student_id, mentor_id)
    meeting = Meeting(
        student_id=body.student_id, service_id=body.service_id, mentor_id=mentor_id, title=body.title,
        meeting_type=body.meeting_type, description=body.description, outcome=body.outcome,
        starts_at=body.starts_at, ends_at=body.ends_at, meeting_link=body.meeting_link,
        created_by=current_user.id,
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    return meeting


@router.patch("/meetings/{meeting_id}", response_model=MeetingOut)
async def update_meeting(meeting_id: uuid.UUID, body: MeetingUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    result = await db.execute(
        select(Meeting).options(selectinload(Meeting.note_session)).where(Meeting.id == meeting_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise _NOT_FOUND
    await _assert_staff(db, meeting.student_id, current_user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(meeting, field, value)
    await db.commit()
    await db.refresh(meeting)
    return meeting


@router.delete("/meetings/{meeting_id}", status_code=204)
async def delete_meeting(meeting_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise _NOT_FOUND
    await _assert_staff(db, meeting.student_id, current_user)
    await db.delete(meeting)
    await db.commit()


@router.post("/meetings/{meeting_id}/ai-actions", response_model=StudentNoteResponse, status_code=201)
async def create_meeting_ai_actions(
    meeting_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Meeting, Student.full_name)
        .join(Student, Student.id == Meeting.student_id)
        .options(selectinload(Meeting.note_session))
        .where(Meeting.id == meeting_id)
    )
    row = result.first()
    if not row:
        raise _NOT_FOUND
    meeting, student_name = row
    await _assert_staff(db, meeting.student_id, current_user)

    session = meeting.note_session
    if session and session.note_id:
        note = await db.get(StudentNote, session.note_id)
        if note:
            return _note_to_response(note, student_name)

    source_text = await _meeting_source_text(db, meeting)

    if not meeting.description.strip() and not meeting.outcome.strip() and "Транскрипт:" not in source_text:
        raise HTTPException(status_code=409, detail="Нет повестки, итога или транскрипта для AI-разбора")

    student = await db.get(Student, meeting.student_id)
    snapshot = snapshot_student(student) if student else {}
    draft = await generate_note_draft(
        transcript=source_text,
        title=f"AI-разбор звонка: {meeting.title}",
        snapshot=snapshot,
        student_name=student_name,
    )
    draft.pop("__ai_meta", None)

    if not session:
        session = NoteSession(
            student_id=meeting.student_id,
            meeting_id=meeting.id,
            title=f"Конспект: {meeting.title}",
            source="meeting_ai_actions",
            status=NoteSessionStatus.completed,
            started_at=meeting.starts_at,
            ended_at=datetime.now(timezone.utc),
            last_heartbeat_at=datetime.now(timezone.utc),
            created_by=current_user.id,
        )
        db.add(session)
        await db.flush()

    note = StudentNote(
        student_id=meeting.student_id,
        title=draft["title"],
        source_text=source_text,
        summary_markdown=draft["summary_markdown"],
        profile_snapshot=snapshot,
        suggested_changes=draft["suggested_changes"],
        applied_changes={},
        status=StudentNoteStatus.draft,
        created_by=current_user.id,
        reviewed_by=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(note)
    await db.flush()

    session.note_id = note.id
    session.status = NoteSessionStatus.completed
    if not session.ended_at:
        session.ended_at = datetime.now(timezone.utc)
    session.last_heartbeat_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(note)
    return _note_to_response(note, student_name)


@router.post("/meetings/{meeting_id}/follow-up-draft")
async def create_meeting_follow_up_draft(
    meeting_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Meeting, Student.full_name)
        .join(Student, Student.id == Meeting.student_id)
        .options(selectinload(Meeting.note_session))
        .where(Meeting.id == meeting_id)
    )
    row = result.first()
    if not row:
        raise _NOT_FOUND
    meeting, student_name = row
    await _assert_staff(db, meeting.student_id, current_user)

    source_text = await _meeting_source_text(db, meeting)
    if not meeting.description.strip() and not meeting.outcome.strip() and "Транскрипт:" not in source_text:
        raise HTTPException(status_code=409, detail="Нет повестки, итога или транскрипта для follow-up")

    if provider_chain():
        user_message = f"""Студент: {student_name or 'не указан'}

Контекст звонка:
{source_text}

Составь follow-up сообщение после звонка.
Укажи только то, что подтверждено контекстом.
Если есть следующие шаги — оформи их коротким списком.
Если конкретных следующих шагов нет — попроси подтвердить, всё ли верно зафиксировано."""
        message = (await complete_with_fallback(FOLLOW_UP_SYSTEM, user_message)).strip()
    else:
        message = _fallback_follow_up(meeting, student_name, source_text)

    return {
        "meeting_id": str(meeting.id),
        "student_id": str(meeting.student_id),
        "student_name": student_name,
        "message": message,
        "auto_sent": False,
    }


@router.post("/meetings/{meeting_id}/follow-up-send")
async def send_meeting_follow_up(
    meeting_id: uuid.UUID,
    body: SendFollowUpBody,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    result = await db.execute(
        select(Meeting, Student)
        .join(Student, Student.id == Meeting.student_id)
        .where(Meeting.id == meeting_id)
    )
    row = result.first()
    if not row:
        raise _NOT_FOUND
    meeting, student = row
    await _assert_staff(db, meeting.student_id, current_user)

    text = body.message.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Пустое follow-up сообщение")
    if not student.user_id:
        raise HTTPException(status_code=409, detail="У студента нет доступа в кабинет — отправка в чат невозможна")

    conv = await _get_or_create_direct(db, current_user.id, student.user_id, current_user.id)
    msg = await _send_chat_message(db, conv, current_user, text, "/portal/chat")

    return {
        "meeting_id": str(meeting.id),
        "student_id": str(student.id),
        "conversation_id": str(conv.id),
        "message_id": str(msg.id),
        "sent": True,
        "auto_sent": False,
    }
