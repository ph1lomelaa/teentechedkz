from __future__ import annotations

import secrets
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.core.audit import log_change
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import AllStaff, CurrentUser
from app.core.encryption import encrypt
from app.models.ai_analysis_run import AiAnalysisRun
from app.models.communication_log import CommunicationLog, CommSource, MessageType
from app.models.confidential_note import ConfidentialNote, NoteVisibility
from app.models.pending_insight import InsightStatus, PendingInsight
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
from app.models.telegram_chat import TelegramChat, TelegramChatStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage
from app.models.telegram_pairing_code import TelegramPairingCode
from app.models.mentor_assignment import MentorAssignment
from app.models.user import User
from app.services.mentor_scope import mentor_assigned_student_ids
from app.services.minio_service import close_minio_object, get_minio
from app.services.student_context_ai import generate_context_review_draft
from app.services.student_notes import apply_student_updates, build_profile_diff, humanize_field, humanize_value, snapshot_student

router = APIRouter(prefix="/telegram-chats", tags=["telegram-chats"])

PAIRING_CODE_TTL_MINUTES = 30
IMPORTANT_CONTEXT_RE = re.compile(
    r"ielts|айл[тт]с|toefl|sat|сертификат|документ|аттестат|транскрипт|дедлайн|"
    r"\b\d{1,2}[./-]\d{1,2}\b|\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b",
    re.IGNORECASE,
)

StaffUser = Annotated[User, AllStaff]


async def _current_student_id(db: AsyncSession, chat_id: uuid.UUID) -> uuid.UUID | None:
    result = await db.execute(
        select(TelegramChatSession.student_id)
        .where(
            TelegramChatSession.chat_id == chat_id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
        .limit(1)
    )
    row = result.first()
    return row[0] if row else None


async def _student_responsibles(db: AsyncSession, student_id: uuid.UUID | None, current_user_id: uuid.UUID) -> tuple[list[dict], bool]:
    if student_id is None:
        return [], False
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.student_id == student_id)
        .order_by(MentorAssignment.assigned_at.desc())
    )
    assignments = result.scalars().all()
    responsibles = [
        {
            "id": str(a.mentor_id),
            "assignment_id": str(a.id),
            "name": a.mentor.name if a.mentor else None,
            "role": a.role.value,
            "is_active": a.is_active,
        }
        for a in assignments
    ]
    is_mine = any(a.mentor_id == current_user_id and a.is_active for a in assignments)
    return responsibles, is_mine


async def _require_chat_access(db: AsyncSession, chat_id: uuid.UUID, current_user: User) -> None:
    """404s (not 403) if a mentor tries to reach a chat outside their assignments —
    avoids revealing that the chat exists at all."""
    allowed_ids = await mentor_assigned_student_ids(db, current_user)
    if allowed_ids is None:
        return
    student_id = await _current_student_id(db, chat_id)
    if student_id is None or student_id not in allowed_ids:
        raise HTTPException(status_code=404, detail="Чат не найден")


@router.get("/")
async def list_chats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
    status: str | None = None,
    scope: str = "all",
):
    query = select(TelegramChat).order_by(TelegramChat.created_at.desc())
    if status:
        try:
            query = query.where(TelegramChat.status == TelegramChatStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")

    result = await db.execute(query)
    chats = result.scalars().all()

    dicts = []
    for c in chats:
        chat_dict = await _chat_to_dict(db, c, current_user=current_user)
        if scope == "mine" and not chat_dict["is_mine"]:
            continue
        if scope == "unassigned" and chat_dict["responsible_count"] > 0:
            continue
        dicts.append(chat_dict)
    return dicts


@router.get("/unbound")
async def list_unbound_chats(db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    result = await db.execute(
        select(TelegramChat)
        .where(TelegramChat.status == TelegramChatStatus.unbound)
        .order_by(TelegramChat.created_at.desc())
    )
    chats = result.scalars().all()
    return [await _chat_to_dict(db, c) for c in chats]


@router.get("/student/{student_id}")
async def get_student_chat(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(TelegramChatSession)
        .where(
            TelegramChatSession.student_id == student_id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
    )
    session = result.scalars().first()
    if not session:
        return None

    chat = await db.get(TelegramChat, session.chat_id)
    return await _chat_to_dict(db, chat, session=session)


@router.get("/{chat_id}")
async def get_chat(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    return await _chat_to_dict(db, chat)


@router.post("/{chat_id}/attach")
async def attach_chat(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    student_id = body.get("student_id")
    if not student_id:
        raise HTTPException(status_code=422, detail="student_id обязателен")

    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    student = await db.get(Student, uuid.UUID(str(student_id)))
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    result = await db.execute(
        select(TelegramChatSession).where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
    )
    for existing_session in result.scalars().all():
        existing_session.status = TelegramSessionStatus.closed
        existing_session.closed_at = datetime.now(timezone.utc)

    chat.status = TelegramChatStatus.active
    session = TelegramChatSession(chat_id=chat.id, student_id=student.id, opened_by=current_user.id)
    db.add(session)
    await db.commit()
    await db.refresh(chat)
    return await _chat_to_dict(db, chat, session=session)


@router.post("/{chat_id}/reassign")
async def reassign_chat(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    student_id = body.get("student_id")
    if not student_id:
        raise HTTPException(status_code=422, detail="student_id обязателен")
    student_id = uuid.UUID(str(student_id))

    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    result = await db.execute(
        select(TelegramChatSession).where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
    )
    current_session = result.scalars().first()

    if current_session and current_session.student_id == student_id:
        chat.status = TelegramChatStatus.active
        await db.commit()
        await db.refresh(chat)
        return await _chat_to_dict(db, chat, session=current_session)

    if current_session:
        current_session.status = TelegramSessionStatus.closed
        current_session.closed_at = datetime.now(timezone.utc)

    new_session = TelegramChatSession(chat_id=chat.id, student_id=student_id, opened_by=current_user.id)
    db.add(new_session)
    chat.status = TelegramChatStatus.active

    await db.commit()
    await db.refresh(chat)
    return await _chat_to_dict(db, chat, session=new_session)


@router.post("/{chat_id}/pause")
async def pause_chat(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    chat.status = TelegramChatStatus.paused
    await db.commit()
    return await _chat_to_dict(db, chat)


@router.post("/{chat_id}/resume")
async def resume_chat(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    if chat.status == TelegramChatStatus.paused:
        chat.status = TelegramChatStatus.active
        await db.commit()
    return await _chat_to_dict(db, chat)


@router.post("/{chat_id}/close")
async def close_chat(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    result = await db.execute(
        select(TelegramChatSession).where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
    )
    for session in result.scalars().all():
        session.status = TelegramSessionStatus.closed
        session.closed_at = datetime.now(timezone.utc)

    chat.status = TelegramChatStatus.closed
    await db.commit()
    return await _chat_to_dict(db, chat)


@router.get("/{chat_id}/messages")
async def list_chat_messages(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    result = await db.execute(
        select(TelegramMessage)
        .where(TelegramMessage.chat_id == chat_id)
        .options(selectinload(TelegramMessage.attachments))
        .order_by(TelegramMessage.created_at)
    )
    messages = result.scalars().all()
    return [await _message_to_dict(m) for m in messages]


@router.post("/{chat_id}/context-draft")
async def create_context_draft(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    student_id = await _current_student_id(db, chat_id)
    if not student_id:
        raise HTTPException(status_code=422, detail="Чат не привязан к студенту")
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    limit = int(body.get("limit") or 30)
    limit = max(5, min(limit, 80))
    result = await db.execute(
        select(TelegramMessage)
        .where(TelegramMessage.chat_id == chat_id)
        .options(selectinload(TelegramMessage.attachments))
        .order_by(TelegramMessage.created_at.desc(), TelegramMessage.id.desc())
        .limit(limit)
    )
    messages = list(reversed(result.scalars().all()))
    if not messages:
        raise HTTPException(status_code=422, detail="В чате нет сообщений для анализа")

    source_text = _messages_context_text(messages)
    attachments = _messages_attachment_context(messages)
    snapshot = snapshot_student(student)
    draft = await generate_context_review_draft(
        source_text=source_text,
        snapshot=snapshot,
        attachments=attachments,
    )
    ai_meta = draft.pop("__ai_meta", {})
    last_message = messages[-1]
    db.add(
        AiAnalysisRun(
            source_type="telegram_context_draft",
            source_id=chat.id,
            student_id=student.id,
            source_last_message_id=last_message.id,
            status="draft_created",
            prompt_version=str(ai_meta.get("prompt_version") or "unknown"),
            model=ai_meta.get("model"),
            input_snapshot={
                "message_count": len(messages),
                "source_text": source_text,
                "attachments": attachments,
                "profile_snapshot": snapshot,
            },
            raw_output=ai_meta.get("raw_output"),
            parsed_output=ai_meta.get("parsed_output") or draft,
            filter_reasons=ai_meta.get("filter_reasons") or {},
            created_by=current_user.id,
        )
    )
    await db.commit()
    draft["source_text"] = source_text
    draft["profile_snapshot"] = snapshot
    draft["student_id"] = str(student.id)
    draft["student_name"] = student.full_name
    draft["source_last_message_id"] = str(last_message.id)
    draft["prompt_version"] = str(ai_meta.get("prompt_version") or "unknown")
    draft["model"] = ai_meta.get("model")
    return draft


@router.post("/{chat_id}/context-draft/apply")
async def apply_context_draft(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    student_id = await _current_student_id(db, chat_id)
    if not student_id:
        raise HTTPException(status_code=422, detail="Чат не привязан к студенту")
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    source_text = str(body.get("source_text") or "").strip()
    if not source_text:
        raise HTTPException(status_code=422, detail="source_text обязателен")

    profile_updates = body.get("profile_updates") if isinstance(body.get("profile_updates"), list) else []
    proposed_changes = {
        str(item.get("field")): item.get("value")
        for item in profile_updates
        if isinstance(item, dict) and item.get("field")
    }
    profile_notes = _clean_body_strings(body.get("profile_notes"))
    follow_ups = _clean_body_strings(body.get("follow_ups"))
    document_flags = _clean_body_strings(body.get("document_flags"))
    contradictions = _clean_body_strings(body.get("contradictions"))
    quality_warnings = _clean_body_strings(body.get("quality_warnings"))
    ignored_as_noise = _clean_body_strings(body.get("ignored_as_noise"))
    summary = " ".join(str(body.get("summary") or "").split())[:1200]

    snapshot = snapshot_student(student)
    applied_changes = apply_student_updates(student, proposed_changes)
    for change in applied_changes:
        await log_change(
            db,
            "student",
            student.id,
            change["field"],
            change["old_value"],
            change["new_value"],
            str(current_user.id),
            source="telegram_context_draft",
        )
    if applied_changes:
        student.updated_at = datetime.now(timezone.utc)

    saved_notes = 0
    for text in [*profile_notes, *follow_ups, *document_flags, *contradictions, *quality_warnings]:
        db.add(
            ConfidentialNote(
                student_id=student.id,
                note_text_encrypted=encrypt(f"Из Telegram-чата: {text}"[:4000]),
                visible_to_role=NoteVisibility.admin_and_mzk,
                created_by=current_user.id,
            )
        )
        saved_notes += 1

    note = StudentNote(
        student_id=student.id,
        title="Заметки из Telegram-чата",
        source_text=source_text,
        summary_markdown=_context_note_markdown(
            summary=summary,
            profile_updates=profile_updates,
            profile_notes=profile_notes,
            follow_ups=follow_ups,
            document_flags=document_flags,
            contradictions=contradictions,
            quality_warnings=quality_warnings,
            ignored_as_noise=ignored_as_noise,
        ),
        profile_snapshot=snapshot,
        suggested_changes={**proposed_changes, "profile_notes": profile_notes},
        applied_changes={"changes": applied_changes, "profile_notes_saved": saved_notes},
        status=StudentNoteStatus.approved,
        created_by=current_user.id,
        reviewed_by=current_user.id,
        created_at=datetime.now(timezone.utc),
        reviewed_at=datetime.now(timezone.utc),
    )
    db.add(note)
    last_message_id = body.get("source_last_message_id")
    db.add(
        AiAnalysisRun(
            source_type="telegram_context_draft",
            source_id=chat_id,
            student_id=student.id,
            source_last_message_id=uuid.UUID(str(last_message_id)) if last_message_id else None,
            status="applied",
            prompt_version=str(body.get("prompt_version") or "manual_review"),
            model=str(body.get("model") or "reviewed_draft"),
            input_snapshot={"source_text": source_text, "profile_snapshot": snapshot},
            raw_output=None,
            parsed_output={
                "summary": summary,
                "profile_updates": profile_updates,
                "profile_notes": profile_notes,
                "follow_ups": follow_ups,
                "document_flags": document_flags,
                "contradictions": contradictions,
                "quality_warnings": quality_warnings,
                "ignored_as_noise": ignored_as_noise,
            },
            filter_reasons={"review": "manager applied edited context draft"},
            created_by=current_user.id,
        )
    )
    db.add(
        CommunicationLog(
            student_id=student.id,
            source=CommSource.telegram,
            message_type=MessageType.text_event,
            raw_text=source_text,
            ai_summary=note.summary_markdown,
        )
    )
    await db.commit()
    await db.refresh(note)
    return {
        "note_id": str(note.id),
        "applied_changes": applied_changes,
        "profile_notes_saved": saved_notes,
    }


@router.get("/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Streams the file through our backend instead of handing out a
    presigned MinIO URL — presigned URLs sign the Host header, and the dev
    hostname rewrite (minio -> localhost) done for browser access breaks
    that signature (SignatureDoesNotMatch)."""
    attachment = await db.get(TelegramAttachment, attachment_id)
    if not attachment or not attachment.storage_path:
        raise HTTPException(status_code=404, detail="Файл не найден")

    message = await db.get(TelegramMessage, attachment.message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Файл не найден")
    await _require_chat_access(db, message.chat_id, current_user)

    client = get_minio()
    obj = client.get_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=attachment.storage_path,
    )

    filename = attachment.file_name or "file"
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "file"
    headers = {
        "Content-Disposition": (
            f'inline; filename="{ascii_fallback}"; '
            f"filename*=UTF-8''{quote(filename)}"
        ),
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        obj,
        media_type=attachment.mime_type or "application/octet-stream",
        headers=headers,
        background=BackgroundTask(close_minio_object, obj),
    )


@router.get("/{chat_id}/insights")
async def list_chat_insights(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    result = await db.execute(
        select(PendingInsight)
        .join(TelegramMessage, PendingInsight.source_telegram_message_id == TelegramMessage.id)
        .where(TelegramMessage.chat_id == chat_id)
        .order_by(PendingInsight.created_at.desc())
    )
    insights = result.scalars().all()

    out = []
    for insight in insights:
        insight_dict = _insight_to_dict(insight)
        if insight.status == InsightStatus.pending:
            student = await db.get(Student, insight.student_id)
            diff = build_profile_diff(snapshot_student(student), insight.proposed_changes or {}) if student else []
        else:
            diff = [
                {"field": field, "old_value": None, "new_value": value}
                for field, value in (insight.proposed_changes or {}).items()
            ]
        insight_dict["diff"] = diff
        out.append(insight_dict)
    return out


@router.post("/pairing-code")
async def create_pairing_code(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    student_id = body.get("student_id")
    if not student_id:
        raise HTTPException(status_code=422, detail="student_id обязателен")

    student = await db.get(Student, uuid.UUID(str(student_id)))
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    if not settings.TELEGRAM_BOT_USERNAME:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_USERNAME не настроен")

    code = secrets.token_urlsafe(9)
    pairing = TelegramPairingCode(
        code=code,
        student_id=student.id,
        created_by=current_user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=PAIRING_CODE_TTL_MINUTES),
    )
    db.add(pairing)
    await db.commit()

    return {
        "code": code,
        "deep_link": f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={code}",
        "expires_at": pairing.expires_at.isoformat(),
    }


async def _chat_to_dict(
    db: AsyncSession,
    chat: TelegramChat,
    session: TelegramChatSession | None = None,
    current_user: User | None = None,
) -> dict:
    if session is None:
        result = await db.execute(
            select(TelegramChatSession)
            .where(TelegramChatSession.chat_id == chat.id, TelegramChatSession.status == TelegramSessionStatus.active)
            .order_by(TelegramChatSession.opened_at.desc())
        )
        session = result.scalars().first()

    last_message_result = await db.execute(
        select(TelegramMessage.raw_text, TelegramMessage.created_at)
        .where(TelegramMessage.chat_id == chat.id)
        .order_by(TelegramMessage.created_at.desc())
        .limit(1)
    )
    last_message = last_message_result.first()

    student_name = None
    if session and session.student_id:
        student = await db.get(Student, session.student_id)
        student_name = student.full_name if student else None
    responsibles, is_mine = await _student_responsibles(
        db,
        session.student_id if session else None,
        current_user.id if current_user else uuid.UUID(int=0),
    )

    pending_insight_count = (
        await db.execute(
            select(func.count(PendingInsight.id))
            .select_from(PendingInsight)
            .join(TelegramMessage, PendingInsight.source_telegram_message_id == TelegramMessage.id)
            .where(TelegramMessage.chat_id == chat.id, PendingInsight.status == InsightStatus.pending)
        )
    ).scalar_one()

    unresolved_attachment_count = (
        await db.execute(
            select(func.count(TelegramAttachment.id))
            .select_from(TelegramAttachment)
            .join(TelegramMessage, TelegramAttachment.message_id == TelegramMessage.id)
            .where(
                TelegramMessage.chat_id == chat.id,
                TelegramAttachment.status.not_in(
                    [TelegramAttachmentStatus.downloaded, TelegramAttachmentStatus.parsed]
                ),
            )
        )
    ).scalar_one()

    context_signal_count = await _context_signal_count(db, chat.id)

    return {
        "id": str(chat.id),
        "chat_id": chat.chat_id,
        "chat_type": chat.chat_type.value,
        "title": chat.title,
        "status": chat.status.value,
        "privacy_mode_disabled": chat.privacy_mode_disabled,
        "created_at": chat.created_at.isoformat(),
        "session_id": str(session.id) if session else None,
        "student_id": str(session.student_id) if session and session.student_id else None,
        "student_name": student_name,
        "last_message_preview": last_message[0] if last_message else None,
        "last_message_at": last_message[1].isoformat() if last_message else None,
        "pending_insight_count": pending_insight_count,
        "unresolved_attachment_count": unresolved_attachment_count,
        "context_signal_count": context_signal_count,
        "has_context_signal": context_signal_count > 0,
        "responsibles": responsibles,
        "responsible_count": len([r for r in responsibles if r["is_active"]]),
        "is_mine": is_mine,
    }


async def _message_to_dict(m: TelegramMessage) -> dict:
    attachments = []
    for a in m.attachments:
        attachments.append(
            {
                "id": str(a.id),
                "file_name": a.file_name,
                "mime_type": a.mime_type,
                "file_size": a.file_size,
                "status": a.status.value,
                "can_download": bool(a.storage_path),
            }
        )
    return {
        "id": str(m.id),
        "telegram_message_id": m.telegram_message_id,
        "sender_name": m.sender_name,
        "message_type": m.message_type.value,
        "raw_text": m.raw_text,
        "created_at": m.created_at.isoformat(),
        "attachments": attachments,
    }


def _insight_to_dict(i: PendingInsight) -> dict:
    return {
        "id": str(i.id),
        "student_id": str(i.student_id),
        "insight_type": i.insight_type.value,
        "proposed_changes": i.proposed_changes,
        "unmatched_fields": i.unmatched_fields,
        "confidence": float(i.confidence),
        "risk_level": i.risk_level.value,
        "status": i.status.value,
        "reviewed_by": str(i.reviewed_by) if i.reviewed_by else None,
        "auto_applied": i.auto_applied,
        "created_at": i.created_at.isoformat(),
        "reviewed_at": i.reviewed_at.isoformat() if i.reviewed_at else None,
    }


def _messages_context_text(messages: list[TelegramMessage]) -> str:
    lines: list[str] = []
    for message in messages:
        stamp = message.created_at.strftime("%d.%m.%Y %H:%M") if message.created_at else ""
        sender = message.sender_name or "Без имени"
        text = " ".join((message.raw_text or "").split())
        attachment_bits = []
        for attachment in message.attachments:
            name = attachment.file_name or attachment.mime_type or "файл"
            attachment_bits.append(f"{name} ({attachment.status.value})")
        if attachment_bits:
            text = f"{text} [вложения: {', '.join(attachment_bits)}]".strip()
        if text:
            lines.append(f"[{stamp}] {sender}: {text}")
    return "\n".join(lines)


def _messages_attachment_context(messages: list[TelegramMessage]) -> list[dict]:
    out: list[dict] = []
    for message in messages:
        for attachment in message.attachments:
            out.append(
                {
                    "message_id": str(message.id),
                    "file_name": attachment.file_name,
                    "mime_type": attachment.mime_type,
                    "status": attachment.status.value,
                    "file_size": attachment.file_size,
                }
            )
    return out[:20]


async def _context_signal_count(db: AsyncSession, chat_id: uuid.UUID) -> int:
    watermark_result = await db.execute(
        select(AiAnalysisRun)
        .where(
            AiAnalysisRun.source_type == "telegram_context_draft",
            AiAnalysisRun.source_id == chat_id,
            AiAnalysisRun.status == "applied",
            AiAnalysisRun.source_last_message_id.is_not(None),
        )
        .order_by(AiAnalysisRun.created_at.desc())
        .limit(1)
    )
    watermark = watermark_result.scalar_one_or_none()
    watermark_message = (
        await db.get(TelegramMessage, watermark.source_last_message_id)
        if watermark and watermark.source_last_message_id
        else None
    )

    query = select(TelegramMessage).where(TelegramMessage.chat_id == chat_id)
    if watermark_message:
        query = query.where(TelegramMessage.created_at > watermark_message.created_at)

    result = await db.execute(
        query
        .options(selectinload(TelegramMessage.attachments))
        .order_by(TelegramMessage.created_at.desc(), TelegramMessage.id.desc())
        .limit(30)
    )
    count = 0
    for message in result.scalars().all():
        text = message.raw_text or ""
        if IMPORTANT_CONTEXT_RE.search(text) or message.attachments:
            count += 1
    return count


def _clean_body_strings(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        text = " ".join(str(item or "").split())[:800]
        if text:
            out.append(text)
    return out[:20]


def _context_note_markdown(
    *,
    summary: str,
    profile_updates: list,
    profile_notes: list[str],
    follow_ups: list[str],
    document_flags: list[str],
    contradictions: list[str],
    quality_warnings: list[str],
    ignored_as_noise: list[str],
) -> str:
    chunks = ["## Заметки из Telegram-чата"]
    if summary:
        chunks.extend(["", summary])

    chunks.extend(["", "**Изменения профиля**"])
    comparable_updates = [item for item in profile_updates if isinstance(item, dict) and item.get("field")]
    if comparable_updates:
        for item in comparable_updates:
            field = str(item.get("field"))
            old_value = humanize_value(item.get("old_value"))
            new_value = humanize_value(item.get("value"))
            reason = str(item.get("reason") or "").strip()
            suffix = f" — {reason}" if reason else ""
            chunks.append(f"- {humanize_field(field)}: {old_value} → {new_value}{suffix}")
    else:
        chunks.append("- Подтверждённых изменений полей нет.")

    sections = [
        ("Заметки профиля", profile_notes),
        ("Follow-up", follow_ups),
        ("Документы", document_flags),
        ("Противоречия/неясности", contradictions),
        ("Предупреждения качества", quality_warnings),
        ("Не сохранено как шум", ignored_as_noise),
    ]
    for title, items in sections:
        if not items:
            continue
        chunks.extend(["", f"**{title}**"])
        chunks.extend(f"- {item}" for item in items)

    return "\n".join(chunks)
