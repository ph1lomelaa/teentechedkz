from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import AdminOrMZK, AllStaff, CurrentUser
from app.models.pending_insight import InsightStatus, PendingInsight
from app.models.student import Student
from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
from app.models.telegram_chat import TelegramChat, TelegramChatStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage
from app.models.telegram_pairing_code import TelegramPairingCode
from app.models.user import User
from app.services.mentor_scope import mentor_assigned_student_ids
from app.services.minio_service import minio_url
from app.services.student_notes import build_profile_diff, snapshot_student

router = APIRouter(prefix="/telegram-chats", tags=["telegram-chats"])

PAIRING_CODE_TTL_MINUTES = 30

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
):
    query = select(TelegramChat).order_by(TelegramChat.created_at.desc())
    if status:
        try:
            query = query.where(TelegramChat.status == TelegramChatStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")

    result = await db.execute(query)
    chats = result.scalars().all()

    allowed_ids = await mentor_assigned_student_ids(db, current_user)
    dicts = []
    for c in chats:
        chat_dict = await _chat_to_dict(db, c)
        if allowed_ids is not None:
            if not chat_dict["student_id"] or uuid.UUID(chat_dict["student_id"]) not in allowed_ids:
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


@router.post("/{chat_id}/attach", dependencies=[AdminOrMZK])
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

    chat.status = TelegramChatStatus.active
    session = TelegramChatSession(chat_id=chat.id, student_id=student.id, opened_by=current_user.id)
    db.add(session)
    await db.commit()
    await db.refresh(chat)
    return await _chat_to_dict(db, chat, session=session)


@router.post("/{chat_id}/reassign", dependencies=[AdminOrMZK])
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


@router.post("/{chat_id}/pause", dependencies=[AdminOrMZK])
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


@router.post("/{chat_id}/resume", dependencies=[AdminOrMZK])
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


@router.post("/{chat_id}/close", dependencies=[AdminOrMZK])
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


@router.post("/pairing-code", dependencies=[AdminOrMZK])
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


async def _chat_to_dict(db: AsyncSession, chat: TelegramChat, session: TelegramChatSession | None = None) -> dict:
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
    }


async def _message_to_dict(m: TelegramMessage) -> dict:
    attachments = []
    for a in m.attachments:
        attachments.append(
            {
                "id": str(a.id),
                "mime_type": a.mime_type,
                "file_size": a.file_size,
                "status": a.status.value,
                "download_url": await minio_url(a.storage_path) if a.storage_path else None,
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
