"""Portal-general endpoints for the logged-in student."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentStudent, CurrentUser
from app.core.encryption import decrypt
from app.models.confidential_note import ConfidentialNote
from app.models.user import UserRole
from app.models.student import Student
from app.models.student_note import StudentNote
from app.models.telegram_chat import TelegramChat, TelegramChatStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage, TelegramMessageType
from app.models.meeting import Meeting, MeetingStatus
from app.services.note_blocks import filter_visible
from app.services.telegram_bot import get_bot
from app.services.telegram_ingest import dump_telegram_object
from pydantic import BaseModel

router = APIRouter(tags=["portal"])


class SendTelegramMessageRequest(BaseModel):
    text: str


def _portal_note_dict(note: StudentNote, *, full: bool = False) -> dict:
    """Student-safe projection of a конспект. Deliberately excludes internal
    fields (source transcript, AI suggested changes, profile snapshot, status)
    and drops any blocks the manager hid."""
    data = {
        "id": str(note.id),
        "title": note.student_title or note.title,
        "published_at": note.published_at.isoformat() if note.published_at else None,
        "created_at": note.created_at.isoformat(),
    }
    if full:
        # student_summary_markdown is the reworded-for-the-student text; NULL
        # for notes created before that field existed, so fall back to the
        # mentor text (filtered) exactly as before.
        data["summary_markdown"] = filter_visible(
            note.student_summary_markdown or note.summary_markdown, note.hidden_blocks
        )
    return data


@router.get("/portal/important-notes")
async def portal_important_notes(
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Важные заметки о студенте, которые ментор явно открыл ученику. Только
    чтение, student-safe проекция (без автора/роли/внутренней видимости)."""
    result = await db.execute(
        select(ConfidentialNote)
        .where(
            ConfidentialNote.student_id == student.id,
            ConfidentialNote.visible_to_student == True,  # noqa: E712
        )
        .order_by(ConfidentialNote.created_at.desc())
    )
    notes = []
    for n in result.scalars().all():
        text = None
        if n.note_text_encrypted:
            try:
                text = decrypt(n.note_text_encrypted)
            except Exception:
                continue  # skip an undecryptable note rather than leaking a marker
        if not text:
            continue
        notes.append({"id": str(n.id), "note_text": text, "created_at": n.created_at.isoformat()})
    return notes


@router.get("/portal/profile")
async def portal_profile(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
    res = await db.execute(select(Student).where(Student.user_id == current_user.id))
    student = res.scalar_one_or_none()
    return {
        "user": {
            "id": str(current_user.id),
            "name": current_user.name,
            "email": current_user.email,
            "phone": current_user.phone,
        },
        "student": None if not student else {
            "id": str(student.id),
            "full_name": student.full_name,
            "phone": student.phone,
            "city": student.city,
            "age": student.age,
            "degree_level": student.degree_level.value,
            "specialty": student.specialty,
            "intake_year": student.intake_year,
            "intake_season": student.intake_season.value if student.intake_season else None,
        },
    }


@router.get("/portal/notes")
async def portal_notes(
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Конспекты, опубликованные менеджером в кабинет ученика."""
    result = await db.execute(
        select(StudentNote)
        .where(
            StudentNote.student_id == student.id,
            StudentNote.published_to_student == True,  # noqa: E712
        )
        .order_by(StudentNote.published_at.desc().nullslast(), StudentNote.created_at.desc())
    )
    return [_portal_note_dict(n) for n in result.scalars().all()]


@router.get("/portal/telegram")
async def portal_telegram(
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Зеркало Telegram-группы ученика: те же сообщения, что ученик и так видит
    в своём Telegram, но внутри кабинета. Отправка — см. portal_telegram_send
    ниже, сообщения студента доставляются в группу через бота."""
    session_result = await db.execute(
        select(TelegramChatSession)
        .where(
            TelegramChatSession.student_id == student.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
        .limit(1)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        return {"chat": None, "messages": []}
    chat = await db.get(TelegramChat, session.chat_id)
    if not chat or chat.status == TelegramChatStatus.unbound:
        return {"chat": None, "messages": []}

    messages_result = await db.execute(
        select(TelegramMessage)
        .options(selectinload(TelegramMessage.attachments))
        .where(TelegramMessage.chat_id == chat.id)
        .order_by(TelegramMessage.created_at.desc(), TelegramMessage.id.desc())
        .limit(200)
    )
    messages = list(reversed(messages_result.scalars().all()))
    my_tg_id = str(student.telegram_user_id) if student.telegram_user_id else None
    return {
        "chat": {"id": str(chat.id), "title": chat.title, "status": chat.status.value},
        "messages": [
            {
                "id": str(m.id),
                "sender_name": m.sender_name,
                "raw_text": m.raw_text,
                "message_type": m.message_type.value,
                "is_me": bool(my_tg_id and m.sender_tg_id is not None and str(m.sender_tg_id) == my_tg_id),
                "created_at": m.created_at.isoformat(),
                "attachments": [
                    {"id": str(a.id), "file_name": a.file_name, "mime_type": a.mime_type}
                    for a in m.attachments
                ],
            }
            for m in messages
        ],
    }


@router.post("/portal/telegram/send")
async def portal_telegram_send(
    payload: SendTelegramMessageRequest,
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Отправить сообщение в Telegram-группу студента."""
    if not payload.text or not payload.text.strip():
        raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")

    if len(payload.text) > 4096:
        raise HTTPException(status_code=400, detail="Сообщение слишком длинное (максимум 4096 символов)")

    session_result = await db.execute(
        select(TelegramChatSession)
        .where(
            TelegramChatSession.student_id == student.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
        .limit(1)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=400, detail="Telegram-группа не подключена")

    chat = await db.get(TelegramChat, session.chat_id)
    if not chat or chat.status == TelegramChatStatus.unbound:
        raise HTTPException(status_code=400, detail="Telegram-группа не привязана")

    try:
        bot = get_bot()
        sent = await bot.send_message(chat_id=chat.chat_id, text=payload.text.strip())

        # Bug #4 fix: persist student's message in the database
        message = TelegramMessage(
            chat_id=chat.id,
            session_id=session.id,
            telegram_message_id=sent.message_id,
            update_id=None,
            sent_by_user_id=student.user_id,
            sender_tg_id=None,
            sender_name=student.full_name,
            message_type=TelegramMessageType.text,
            raw_text=payload.text.strip(),
            raw_payload=dump_telegram_object(sent),
        )
        db.add(message)
        await db.commit()

        return {"success": True, "message": "Сообщение отправлено"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка отправки: {str(e)}")


@router.get("/portal/notes/{note_id}")
async def portal_note_detail(
    note_id: uuid.UUID,
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    note = await db.get(StudentNote, note_id)
    if not note or note.student_id != student.id or not note.published_to_student:
        raise HTTPException(status_code=404, detail="Конспект не найден")
    return _portal_note_dict(note, full=True)


def _ical_escape(text: str) -> str:
    """Escape special characters in iCal."""
    return text.replace("\\", "\\\\").replace("\n", "\\n").replace(",", "\\,").replace(";", "\\;")


def _ical_format_time(dt: datetime) -> str:
    """Format datetime for iCal (yyyymmddThhmmssZ)."""
    utc_dt = dt.astimezone(timezone.utc)
    return utc_dt.strftime("%Y%m%dT%H%M%SZ")


@router.get("/portal/export/meetings/ical")
async def export_meetings_ical(
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Export upcoming meetings as iCal file."""
    result = await db.execute(
        select(Meeting)
        .where(Meeting.student_id == student.id)
        .order_by(Meeting.starts_at.asc())
    )
    meetings = result.scalars().all()

    ical_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TeenTechEd//Student Portal//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ]

    for meeting in meetings:
        ical_lines.extend([
            "BEGIN:VEVENT",
            f"UID:meeting-{meeting.id}@teenteched.local",
            f"DTSTART:{_ical_format_time(meeting.starts_at)}",
            f"DTEND:{_ical_format_time(meeting.ends_at)}",
            f"SUMMARY:{_ical_escape(meeting.title)}",
            f"DESCRIPTION:{_ical_escape(meeting.description or '')}",
            f"LOCATION:{_ical_escape(meeting.meeting_link or '')}",
            f"STATUS:{meeting.status.value.upper()}",
            "END:VEVENT",
        ])

    ical_lines.append("END:VCALENDAR")

    content = "\r\n".join(ical_lines).encode("utf-8")
    filename = f"meetings_{datetime.now(timezone.utc).strftime('%Y%m%d')}.ics"

    return Response(
        content=content,
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/portal/export/notes/markdown")
async def export_notes_markdown(
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Export all published notes as markdown file."""
    result = await db.execute(
        select(StudentNote)
        .where(
            StudentNote.student_id == student.id,
            StudentNote.published_to_student == True,  # noqa: E712
        )
        .order_by(StudentNote.published_at.desc().nullslast(), StudentNote.created_at.desc())
    )
    notes = result.scalars().all()

    md_lines = ["# Конспекты\n"]

    for note in notes:
        md_lines.append(f"## {note.student_title or note.title}")
        if note.published_at:
            md_lines.append(f"_Опубликовано: {note.published_at.strftime('%d.%m.%Y %H:%M')}_\n")
        md_lines.append(filter_visible(note.student_summary_markdown or note.summary_markdown or "", note.hidden_blocks) or "")
        md_lines.append("\n---\n")

    content = "\n".join(md_lines).encode("utf-8")
    filename = f"notes_{datetime.now(timezone.utc).strftime('%Y%m%d')}.md"

    return Response(
        content=content,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
