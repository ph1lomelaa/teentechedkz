from __future__ import annotations

import secrets
import re
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.core.audit import log_change
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import AllStaff, CurrentUser
from app.core.permissions import Action, require_access
from app.core.encryption import decrypt, encrypt
from app.models.ai_analysis_run import AiAnalysisRun
from app.models.application import Application
from app.models.communication_log import CommunicationLog, CommSource, MessageType
from app.models.confidential_note import ConfidentialNote, default_note_visibility_for, is_near_duplicate_note
from app.models.contract import Contract
from app.models.pending_insight import InsightStatus, PendingInsight
from app.models.roadmap import Roadmap, RoadmapStatus
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.student_task import StudentTask, TaskStatus
from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
from app.models.telegram_chat import TelegramChat, TelegramChatStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage, TelegramMessageType
from app.models.telegram_pairing_code import TelegramPairingCode
from app.models.telegram_invite_link import TelegramInviteLink
from app.models.telegram_participant_identity import TelegramParticipantIdentity
from app.models.audit_log import AuditAction
from app.services.audit import record_audit
from app.models.mentor_assignment import MentorAssignment
from app.models.user import User, UserRole
from app.services.mentor_scope import mentor_assigned_student_ids, require_student_access
from app.services.minio_service import close_minio_object, get_minio
from app.services.note_sessions import reformulate_for_student
from app.services.student_context_ai import generate_context_review_draft
from app.services.student_notes import apply_student_updates, build_profile_diff, humanize_field, humanize_value, snapshot_student
from app.services.telegram_bot import get_bot
from app.services.telegram_ingest import dump_telegram_object

router = APIRouter(prefix="/telegram-chats", tags=["telegram-chats"])

PAIRING_CODE_TTL_MINUTES = 30
TELEGRAM_GROUP_TITLE_MAX_LENGTH = 128
IMPORTANT_CONTEXT_RE = re.compile(
    r"ielts|айл[тт]с|toefl|sat|сертификат|документ|аттестат|транскрипт|дедлайн|"
    r"\b\d{1,2}[./-]\d{1,2}\b|\b\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\b",
    re.IGNORECASE,
)

MAX_TELEGRAM_EXPORT_BYTES = 30 * 1024 * 1024

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


async def _cancel_open_pairings(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    """Keep group discovery unambiguous: one pending request per staff user."""
    await db.execute(
        update(TelegramPairingCode)
        .where(
            TelegramPairingCode.created_by == user_id,
            TelegramPairingCode.used_at.is_(None),
            TelegramPairingCode.cancelled_at.is_(None),
        )
        .values(cancelled_at=now)
    )


async def _pairing_for_actor(
    db: AsyncSession,
    code: str,
    current_user: User,
    *,
    lock: bool = False,
) -> TelegramPairingCode:
    query = select(TelegramPairingCode).where(TelegramPairingCode.code == code)
    if lock:
        query = query.with_for_update()
    pairing = await db.scalar(query)
    if not pairing:
        raise HTTPException(status_code=404, detail="Заявка подключения не найдена")
    if current_user.role == UserRole.mentor and pairing.created_by != current_user.id:
        raise HTTPException(status_code=404, detail="Заявка подключения не найдена")
    await require_student_access(db, pairing.student_id, current_user)
    return pairing


async def _pairing_candidate_response(
    db: AsyncSession,
    pairing: TelegramPairingCode,
) -> dict:
    now = datetime.now(timezone.utc)
    student = await db.get(Student, pairing.student_id)
    chat = await db.get(TelegramChat, pairing.candidate_chat_id) if pairing.candidate_chat_id else None
    if pairing.used_at:
        status = "confirmed"
    elif pairing.cancelled_at:
        status = "cancelled"
    elif pairing.expires_at <= now:
        status = "expired"
    elif chat:
        status = "detected"
    else:
        status = "waiting"
    return {
        "code": pairing.code,
        "status": status,
        "student_id": str(pairing.student_id),
        "student_name": student.full_name if student else None,
        "expires_at": pairing.expires_at.isoformat(),
        "detected_at": pairing.candidate_detected_at.isoformat() if pairing.candidate_detected_at else None,
        "candidate": {
            "id": str(chat.id),
            "telegram_chat_id": chat.chat_id,
            "title": chat.title,
            "chat_type": chat.chat_type.value,
        } if chat else None,
    }


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
    if not is_mine:
        contract_result = await db.execute(
            select(Contract.id).where(
                Contract.student_id == student_id,
                Contract.mzk_manager_id == current_user_id,
            )
        )
        is_mine = contract_result.scalar_one_or_none() is not None
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


def _onboarding_text(student_name: str, team: list[str], contacts: list[str], response_time: str) -> str:
    lines = [
        f"Добро пожаловать в рабочую группу сопровождения {student_name}.",
        "",
        "Команда:",
        *[f"• {member}" for member in team],
        "",
        "Контакты:",
        *[f"• {contact}" for contact in contacts],
        "",
        f"Срок ответа: {response_time}.",
        "Не отправляйте в этот чат пароли, паспортные данные и другие конфиденциальные сведения.",
        "Существенные договорённости фиксируются в личном кабинете.",
    ]
    return "\n".join(lines)


def _clean_group_title_part(value: object | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" —-")


def build_group_title(full_name: str, country: str | None, intake_year: int) -> str:
    parts = [
        _clean_group_title_part(full_name),
        _clean_group_title_part(country),
        _clean_group_title_part(intake_year),
    ]
    title = " — ".join(part for part in parts if part)
    return title[:TELEGRAM_GROUP_TITLE_MAX_LENGTH].rstrip(" —-")


async def _suggested_group_title(db: AsyncSession, student: Student) -> str:
    """Build `Student — country — year` from the shared CRM/workspace data."""
    roadmap_country = (
        await db.execute(
            select(Roadmap.country_name)
            .where(Roadmap.student_id == student.id, Roadmap.status == RoadmapStatus.active)
            .order_by(Roadmap.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    application_country = None
    if not roadmap_country:
        application_country = (
            await db.execute(
                select(Application.country)
                .where(Application.student_id == student.id)
                .order_by(Application.is_primary.desc(), Application.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    return build_group_title(student.full_name, roadmap_country or application_country, student.intake_year)


@router.get("/")
async def list_chats(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
    status: str | None = None,
    scope: str = Query("all", pattern="^(all|mine|assigned|unassigned)$"),
    mentor_id: uuid.UUID | None = None,
):
    if mentor_id and current_user.role == UserRole.mentor and mentor_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    scoped_student_ids: set[uuid.UUID] | None = None
    if mentor_id:
        assigned = await db.execute(
            select(MentorAssignment.student_id).where(
                MentorAssignment.mentor_id == mentor_id,
                MentorAssignment.is_active == True,  # noqa: E712
            )
        )
        scoped_student_ids = {row[0] for row in assigned.all()}
        if not scoped_student_ids:
            return []

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
        if scoped_student_ids is not None:
            student_id = await _current_student_id(db, c.id)
            if student_id not in scoped_student_ids:
                continue
        chat_dict = await _chat_to_dict(db, c, current_user=current_user)
        if scope == "mine" and not chat_dict["is_mine"]:
            continue
        if scope == "assigned" and chat_dict["responsible_count"] <= 0:
            continue
        if scope == "unassigned" and chat_dict["responsible_count"] > 0:
            continue
        dicts.append(chat_dict)
    return dicts


@router.get("/unbound")
async def list_unbound_chats(db: Annotated[AsyncSession, Depends(get_db)], current_user: StaffUser):
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
    current_user: StaffUser,
):
    await require_student_access(db, student_id, current_user)
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
    current_user: StaffUser,
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
    await require_student_access(db, student.id, current_user)

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
    current_user: StaffUser,
):
    student_id = body.get("student_id")
    if not student_id:
        raise HTTPException(status_code=422, detail="student_id обязателен")
    student_id = uuid.UUID(str(student_id))

    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    await _require_chat_access(db, chat_id, current_user)

    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    await require_student_access(db, student_id, current_user)

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
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
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
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
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
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
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


@router.post("/{chat_id}/unbind")
async def unbind_chat(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Detach a mistakenly attached group while keeping it available to reattach."""
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    student_id = await _current_student_id(db, chat.id)
    result = await db.execute(
        select(TelegramChatSession).where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
    )
    now = datetime.now(timezone.utc)
    for session in result.scalars().all():
        session.status = TelegramSessionStatus.closed
        session.closed_at = now
    chat.status = TelegramChatStatus.unbound
    if student_id:
        record_audit(
            db,
            action=AuditAction.telegram_unlinked,
            actor=current_user,
            target_type="student",
            target_id=str(student_id),
            meta={"kind": "telegram_group", "tg_chat_id": chat.chat_id},
        )
    await db.commit()
    return await _chat_to_dict(db, chat, current_user=current_user)


@router.get("/{chat_id}/messages")
async def list_chat_messages(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=200, ge=1, le=500),
    before_id: uuid.UUID | None = Query(default=None),
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    query = select(TelegramMessage).where(TelegramMessage.chat_id == chat_id)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        query = query.where(
            or_(
                TelegramMessage.raw_text.ilike(pattern),
                TelegramMessage.sender_name.ilike(pattern),
            )
        )
    if before_id:
        before_message = await db.get(TelegramMessage, before_id)
        if before_message and before_message.chat_id == chat_id:
            query = query.where(
                or_(
                    TelegramMessage.created_at < before_message.created_at,
                    (
                        (TelegramMessage.created_at == before_message.created_at)
                        & (TelegramMessage.id < before_message.id)
                    ),
                )
            )

    result = await db.execute(
        query
        .options(selectinload(TelegramMessage.attachments))
        .order_by(TelegramMessage.created_at.desc(), TelegramMessage.id.desc())
        .limit(limit)
    )
    messages = result.scalars().all()
    sender_ids = {message.sender_tg_id for message in messages if message.sender_tg_id is not None}
    identities: dict[int, TelegramParticipantIdentity] = {}
    if sender_ids:
        identity_result = await db.execute(
            select(TelegramParticipantIdentity).where(
                TelegramParticipantIdentity.chat_id == chat_id,
                TelegramParticipantIdentity.telegram_user_id.in_(sender_ids),
            )
        )
        identities = {row.telegram_user_id: row for row in identity_result.scalars().all()}
    return [
        await _message_to_dict(message, identities.get(message.sender_tg_id), current_user.id)
        for message in reversed(messages)
    ]


@router.post("/{chat_id}/messages")
async def send_telegram_message(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat or chat.status != TelegramChatStatus.active:
        raise HTTPException(status_code=409, detail="Telegram-чат не активен")
    session_result = await db.execute(
        select(TelegramChatSession)
        .where(
            TelegramChatSession.chat_id == chat_id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
        .limit(1)
    )
    session = session_result.scalar_one_or_none()
    if not session or not session.student_id:
        raise HTTPException(status_code=422, detail="Чат не привязан к студенту")
    await require_student_access(db, session.student_id, current_user)
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Пустое сообщение")
    if len(text) > 4096:
        raise HTTPException(status_code=422, detail="Telegram допускает не более 4096 символов")
    try:
        sent = await get_bot().send_message(chat_id=chat.chat_id, text=text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Telegram не принял сообщение") from exc
    message = TelegramMessage(
        chat_id=chat.id,
        session_id=session.id,
        telegram_message_id=sent.message_id,
        update_id=None,
        sent_by_user_id=current_user.id,
        sender_tg_id=None,
        sender_name=current_user.name,
        message_type=TelegramMessageType.text,
        raw_text=text,
        raw_payload=dump_telegram_object(sent),
    )
    chat.updated_at = datetime.now(timezone.utc)
    db.add(message)
    await db.flush()
    await log_change(
        db, "telegram_message", message.id, "outbound_sent", None, chat.chat_id,
        str(current_user.id), source="workspace_telegram",
    )
    await db.commit()
    await db.refresh(message)
    return {
        "id": str(message.id),
        "telegram_message_id": message.telegram_message_id,
        "sender_tg_id": None,
        "sender_name": current_user.name,
        "sender_role": "staff",
        "sender_display_name": current_user.name,
        "is_current_user": True,
        "message_type": message.message_type.value,
        "raw_text": message.raw_text,
        "created_at": message.created_at.isoformat(),
        "attachments": [],
    }


@router.post("/{chat_id}/onboarding")
async def publish_onboarding(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    require_access(current_user, "telegram_chats", Action.manage)
    chat = await db.get(TelegramChat, chat_id)
    if not chat or chat.status != TelegramChatStatus.active or chat.chat_type.value == "private":
        raise HTTPException(status_code=409, detail="Onboarding доступен только для активной группы")
    student_id = await _current_student_id(db, chat.id)
    if not student_id:
        raise HTTPException(status_code=422, detail="Сначала привяжите группу к студенту")
    student = await db.get(Student, student_id)
    team = [str(value).strip() for value in body.get("team", []) if str(value).strip()]
    contacts = [str(value).strip() for value in body.get("contacts", []) if str(value).strip()]
    response_time = str(body.get("response_time") or "в течение 1 рабочего дня").strip()
    if not team or not contacts or not response_time:
        raise HTTPException(status_code=422, detail="Нужны команда, контакты и срок ответа")
    if len(team) > 12 or len(contacts) > 12:
        raise HTTPException(status_code=422, detail="Слишком много строк в onboarding")
    text = _onboarding_text(student.full_name if student else "студента", team, contacts, response_time)
    try:
        if chat.onboarding_message_id:
            sent = await get_bot().edit_message_text(
                chat_id=chat.chat_id,
                message_id=chat.onboarding_message_id,
                text=text,
            )
        else:
            sent = await get_bot().send_message(chat_id=chat.chat_id, text=text)
        await get_bot().pin_chat_message(
            chat_id=chat.chat_id,
            message_id=sent.message_id,
            disable_notification=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Telegram не принял onboarding-сообщение") from exc
    chat.onboarding_message_id = sent.message_id
    chat.onboarding_text = text
    chat.onboarding_updated_at = datetime.now(timezone.utc)
    await log_change(
        db,
        "telegram_chat",
        chat.id,
        "onboarding_published",
        None,
        str(sent.message_id),
        str(current_user.id),
        source="workspace_telegram_manager",
    )
    await db.commit()
    return await _chat_to_dict(db, chat, current_user=current_user)


@router.get("/{chat_id}/participants")
async def list_chat_participants(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    message_result = await db.execute(
        select(TelegramMessage.sender_tg_id, TelegramMessage.sender_name)
        .where(TelegramMessage.chat_id == chat_id, TelegramMessage.sender_tg_id.is_not(None))
        .order_by(TelegramMessage.created_at.desc())
    )
    names: dict[int, str | None] = {}
    for telegram_user_id, sender_name in message_result.all():
        names.setdefault(telegram_user_id, sender_name)
    identity_result = await db.execute(
        select(TelegramParticipantIdentity).where(TelegramParticipantIdentity.chat_id == chat_id)
    )
    identities = {row.telegram_user_id: row for row in identity_result.scalars().all()}
    return [
        {
            "telegram_user_id": telegram_user_id,
            "sender_name": sender_name,
            "display_name": identities[telegram_user_id].display_name if telegram_user_id in identities else None,
            "role": identities[telegram_user_id].role if telegram_user_id in identities else "unknown",
            "is_current_user": bool(
                telegram_user_id in identities and identities[telegram_user_id].user_id == current_user.id
            ),
        }
        for telegram_user_id, sender_name in names.items()
    ]


@router.post("/{chat_id}/participants/{telegram_user_id}/identify-self")
async def identify_telegram_participant_as_self(
    chat_id: uuid.UUID,
    telegram_user_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    sender = await db.execute(
        select(TelegramMessage.id, TelegramMessage.sender_name).where(
            TelegramMessage.chat_id == chat_id,
            TelegramMessage.sender_tg_id == telegram_user_id,
        ).limit(1)
    )
    sender_row = sender.first()
    if sender_row is None:
        raise HTTPException(status_code=404, detail="Участник не найден в истории чата")
    sender_name = sender_row[1]

    previous_result = await db.execute(
        select(TelegramParticipantIdentity).where(
            TelegramParticipantIdentity.chat_id == chat_id,
            TelegramParticipantIdentity.user_id == current_user.id,
            TelegramParticipantIdentity.telegram_user_id != telegram_user_id,
        )
    )
    for previous in previous_result.scalars().all():
        previous.user_id = None
        previous.role = "unknown"

    identity_result = await db.execute(
        select(TelegramParticipantIdentity).where(
            TelegramParticipantIdentity.chat_id == chat_id,
            TelegramParticipantIdentity.telegram_user_id == telegram_user_id,
        )
    )
    identity = identity_result.scalar_one_or_none()
    if identity and identity.user_id and identity.user_id != current_user.id:
        raise HTTPException(status_code=409, detail="Этот Telegram-аккаунт уже подтверждён другим сотрудником")
    if not identity:
        identity = TelegramParticipantIdentity(chat_id=chat_id, telegram_user_id=telegram_user_id)
        db.add(identity)
    previous_user_id = identity.user_id
    identity.user_id = current_user.id
    identity.role = current_user.role.value
    identity.display_name = current_user.name
    identity.confirmed_by = current_user.id
    identity.confirmed_at = datetime.now(timezone.utc)
    await db.flush()
    await log_change(
        db, "telegram_participant_identity", identity.id, "user_id",
        previous_user_id, current_user.id, str(current_user.id),
        source="workspace_telegram_identity",
    )
    await db.commit()
    return {
        "telegram_user_id": telegram_user_id,
        "sender_name": sender_name,
        "display_name": identity.display_name,
        "role": identity.role,
        "is_current_user": True,
    }


# Roles a manager can assign to a chat participant from the portal. `mentor`
# marks the staff side of the dialog; `student` the client side; `unknown`
# clears a mistaken tag.
_ASSIGNABLE_PARTICIPANT_ROLES = frozenset({"mentor", "student", "unknown"})


@router.post("/{chat_id}/participants/{telegram_user_id}/set-role")
async def set_telegram_participant_role(
    chat_id: uuid.UUID,
    telegram_user_id: int,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Tag which participant of a group is the mentor (vs the student), so the
    dialog renders on the correct side for everyone — not only for whoever is
    logged in (that's what identify-self does). Works off message senders since
    the Bot API can't enumerate group members."""
    await _require_chat_access(db, chat_id, current_user)

    role = str(body.get("role", "")).strip()
    if role not in _ASSIGNABLE_PARTICIPANT_ROLES:
        raise HTTPException(status_code=422, detail="Недопустимая роль участника")

    sender = await db.execute(
        select(TelegramMessage.sender_name).where(
            TelegramMessage.chat_id == chat_id,
            TelegramMessage.sender_tg_id == telegram_user_id,
        ).limit(1)
    )
    sender_row = sender.first()
    if sender_row is None:
        raise HTTPException(status_code=404, detail="Участник не найден в истории чата")
    sender_name = sender_row[0]

    identity_result = await db.execute(
        select(TelegramParticipantIdentity).where(
            TelegramParticipantIdentity.chat_id == chat_id,
            TelegramParticipantIdentity.telegram_user_id == telegram_user_id,
        )
    )
    identity = identity_result.scalar_one_or_none()
    if not identity:
        identity = TelegramParticipantIdentity(chat_id=chat_id, telegram_user_id=telegram_user_id)
        db.add(identity)
    previous_role = identity.role

    identity.role = role
    identity.display_name = sender_name
    identity.confirmed_by = current_user.id
    identity.confirmed_at = datetime.now(timezone.utc)
    if role == "mentor":
        # Best-effort link to the staff account if this Telegram id is a known user.
        matched = await db.execute(select(User).where(User.telegram_id == str(telegram_user_id)))
        matched_user = matched.scalar_one_or_none()
        identity.user_id = matched_user.id if matched_user else None
    else:
        identity.user_id = None

    await db.flush()
    await log_change(
        db, "telegram_participant_identity", identity.id, "role",
        previous_role, role, str(current_user.id),
        source="workspace_telegram_identity",
    )
    await db.commit()
    return {
        "telegram_user_id": telegram_user_id,
        "sender_name": sender_name,
        "display_name": identity.display_name,
        "role": identity.role,
        "is_current_user": bool(identity.user_id and identity.user_id == current_user.id),
    }


async def _telegram_message_for_action(
    db: AsyncSession,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User,
) -> tuple[TelegramMessage, uuid.UUID]:
    message = await db.get(TelegramMessage, message_id)
    if not message or message.chat_id != chat_id:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    session = await db.get(TelegramChatSession, message.session_id) if message.session_id else None
    if not session or not session.student_id:
        raise HTTPException(status_code=422, detail="Чат не привязан к студенту")
    await require_student_access(db, session.student_id, current_user)
    return message, session.student_id


@router.post("/{chat_id}/messages/{message_id}/task")
async def create_task_from_telegram_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    message, student_id = await _telegram_message_for_action(db, chat_id, message_id, current_user)
    source_text = (message.raw_text or f"Telegram: {message.message_type.value}").strip()
    task_text = str(body.get("task_text") or source_text).strip()
    if not task_text:
        raise HTTPException(status_code=422, detail="Текст задачи пуст")
    task = StudentTask(
        student_id=student_id,
        task_text=task_text,
        created_by=current_user.id,
        status=TaskStatus.open,
    )
    db.add(task)
    await db.flush()
    await log_change(
        db, "student_task", task.id, "created_from_message", None, message.id,
        str(current_user.id), source="workspace_telegram",
    )
    await db.commit()
    await db.refresh(task)
    return {
        "id": str(task.id),
        "student_id": str(task.student_id),
        "task_text": task.task_text,
        "status": task.status.value,
        "created_at": task.created_at.isoformat(),
    }


@router.post("/{chat_id}/messages/{message_id}/note")
async def create_note_from_telegram_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    message, student_id = await _telegram_message_for_action(db, chat_id, message_id, current_user)
    source_text = (message.raw_text or f"Telegram: {message.message_type.value}").strip()
    title = str(body.get("title") or "Заметка из Telegram").strip()
    student = await db.get(Student, student_id)
    summary_markdown = f"## {title}\n\n{source_text}"
    note = StudentNote(
        student_id=student_id,
        title=title,
        source_text=source_text,
        summary_markdown=summary_markdown,
        student_summary_markdown=await reformulate_for_student(summary_markdown, student.full_name if student else None),
        profile_snapshot=snapshot_student(student) if student else {},
        suggested_changes={},
        applied_changes={},
        status=StudentNoteStatus.draft,
        created_by=current_user.id,
    )
    db.add(note)
    await db.flush()
    await log_change(
        db, "student_note", note.id, "created_from_message", None, message.id,
        str(current_user.id), source="workspace_telegram",
    )
    await db.commit()
    await db.refresh(note)
    return {
        "id": str(note.id),
        "student_id": str(note.student_id),
        "title": note.title,
        "status": note.status.value,
        "created_at": note.created_at.isoformat(),
    }


@router.get("/{chat_id}/sessions")
async def list_chat_sessions(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    result = await db.execute(
        select(TelegramChatSession, Student.full_name, User.name)
        .outerjoin(Student, Student.id == TelegramChatSession.student_id)
        .outerjoin(User, User.id == TelegramChatSession.opened_by)
        .where(TelegramChatSession.chat_id == chat_id)
        .order_by(TelegramChatSession.opened_at.desc())
    )
    return [
        {
            "id": str(session.id),
            "chat_id": str(session.chat_id),
            "student_id": str(session.student_id) if session.student_id else None,
            "student_name": student_name,
            "status": session.status.value,
            "opened_by": str(session.opened_by) if session.opened_by else None,
            "opened_by_name": opened_by_name,
            "opened_at": session.opened_at.isoformat(),
            "closed_at": session.closed_at.isoformat() if session.closed_at else None,
        }
        for session, student_name, opened_by_name in result.all()
    ]


@router.get("/{chat_id}/import-capabilities")
async def import_capabilities(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    return {
        "chat_id": str(chat.id),
        "modes": [
            {
                "mode": "desktop_json",
                "enabled": True,
                "label": "Telegram Desktop result.json",
                "description": "Импорт старой истории из экспортированного result.json без хранения user-session.",
            },
            {
                "mode": "client_session",
                "enabled": False,
                "label": "Telegram client session",
                "description": "Прямой импорт через Telethon/Pyrogram требует отдельной защищённой user-session инфраструктуры.",
            },
        ],
        "active_mode": "desktop_json",
    }


@router.post("/{chat_id}/import-json")
async def import_chat_json(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
    file: UploadFile = File(...),
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    content = await file.read()
    if len(content) > MAX_TELEGRAM_EXPORT_BYTES:
        raise HTTPException(status_code=413, detail="Файл экспорта слишком большой")
    try:
        payload = json.loads(content.decode("utf-8-sig"))
    except Exception:
        raise HTTPException(status_code=422, detail="Ожидается Telegram Desktop export result.json")

    raw_messages = payload.get("messages")
    if not isinstance(raw_messages, list):
        raise HTTPException(status_code=422, detail="В JSON нет массива messages")

    session_result = await db.execute(
        select(TelegramChatSession)
        .where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
        .limit(1)
    )
    session = session_result.scalar_one_or_none()

    imported = 0
    skipped = 0
    for raw in raw_messages:
        if not isinstance(raw, dict):
            skipped += 1
            continue
        message_id = raw.get("id")
        if message_id is None:
            skipped += 1
            continue
        try:
            telegram_message_id = int(message_id)
        except (TypeError, ValueError):
            skipped += 1
            continue

        update_id = _import_update_id(chat.chat_id, telegram_message_id)
        existing = await db.scalar(select(TelegramMessage.id).where(TelegramMessage.update_id == update_id))
        if existing:
            skipped += 1
            continue

        text = _telegram_export_text(raw.get("text"))
        attachment_label = _telegram_export_attachment_label(raw)
        if attachment_label:
            text = f"{text}\n[вложение из экспорта: {attachment_label}]".strip()

        row = TelegramMessage(
            chat_id=chat.id,
            session_id=session.id if session else None,
            telegram_message_id=telegram_message_id,
            update_id=update_id,
            sender_tg_id=_telegram_export_sender_id(raw.get("from_id")),
            sender_name=str(raw.get("from") or raw.get("actor") or "").strip() or None,
            message_type=_telegram_export_message_type(raw),
            raw_text=text or None,
            raw_payload={"import_source": "telegram_desktop_json", "raw": raw},
            created_at=_telegram_export_datetime(raw),
        )
        db.add(row)
        imported += 1

    chat.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {
        "chat_id": str(chat.id),
        "mode": "desktop_json",
        "source": "telegram_desktop_json",
        "status": "completed",
        "imported": imported,
        "skipped": skipped,
        "total": len(raw_messages),
    }


async def _existing_confidential_note_texts(db: AsyncSession, student_id: uuid.UUID) -> list[str]:
    result = await db.execute(
        select(ConfidentialNote.note_text_encrypted)
        .where(ConfidentialNote.student_id == student_id)
        .order_by(ConfidentialNote.created_at.desc())
        .limit(50)
    )
    texts = []
    for (encrypted,) in result.all():
        if not encrypted:
            continue
        try:
            texts.append(decrypt(encrypted))
        except Exception:
            continue
    return texts


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
    limit = max(5, min(limit, 120))
    q = " ".join(str(body.get("q") or "").split())[:200]
    query = select(TelegramMessage).where(TelegramMessage.chat_id == chat_id)
    if q:
        pattern = f"%{q}%"
        query = query.where(
            or_(
                TelegramMessage.raw_text.ilike(pattern),
                TelegramMessage.sender_name.ilike(pattern),
            )
        )

    result = await db.execute(
        query
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
    existing_notes = await _existing_confidential_note_texts(db, student.id)
    draft = await generate_context_review_draft(
        source_text=source_text,
        snapshot=snapshot,
        attachments=attachments,
        existing_notes=existing_notes,
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
    draft["source_filter"] = {"q": q, "limit": limit}
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

    existing_notes = await _existing_confidential_note_texts(db, student.id)
    saved_notes = 0
    for text in [*profile_notes, *follow_ups, *document_flags, *contradictions, *quality_warnings]:
        # Staff can re-run/apply a draft over overlapping chat history; skip a fact
        # that's already saved (even reworded) rather than piling up near-duplicates.
        if is_near_duplicate_note(text, existing_notes):
            continue
        db.add(
            ConfidentialNote(
                student_id=student.id,
                note_text_encrypted=encrypt(f"Из Telegram-чата: {text}"[:4000]),
                visible_to_role=default_note_visibility_for(current_user.role),
                created_by=current_user.id,
            )
        )
        existing_notes.append(text)
        saved_notes += 1

    context_note_markdown = _context_note_markdown(
        summary=summary,
        profile_updates=profile_updates,
        profile_notes=profile_notes,
        follow_ups=follow_ups,
        document_flags=document_flags,
        contradictions=contradictions,
        quality_warnings=quality_warnings,
        ignored_as_noise=ignored_as_noise,
    )
    note = StudentNote(
        student_id=student.id,
        title="Заметки из Telegram-чата",
        source_text=source_text,
        summary_markdown=context_note_markdown,
        # Separate student-facing reformulation — context_note_markdown is a
        # manager-oriented field-diff dump ("Изменения профиля" и т.п.), same
        # reasoning as regular конспекты: student must not read CRM jargon.
        student_summary_markdown=await reformulate_for_student(context_note_markdown, student.full_name),
        profile_snapshot=snapshot,
        suggested_changes={**proposed_changes, "profile_notes": profile_notes},
        applied_changes={"changes": applied_changes, "profile_notes_saved": saved_notes},
        status=StudentNoteStatus.approved,
        created_by=current_user.id,
        reviewed_by=current_user.id,
        created_at=datetime.now(timezone.utc),
        reviewed_at=datetime.now(timezone.utc),
        # Publishing to the student portal is now always an explicit,
        # separate "Отправить ученику" action on the note page — no longer
        # automatic here, matching review_note's approve behavior.
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
    current_user: StaffUser,
):
    student_id = body.get("student_id")
    if not student_id:
        raise HTTPException(status_code=422, detail="student_id обязателен")

    student = await db.get(Student, uuid.UUID(str(student_id)))
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    await require_student_access(db, student.id, current_user)

    if not settings.TELEGRAM_BOT_USERNAME:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_USERNAME не настроен")

    now = datetime.now(timezone.utc)
    await _cancel_open_pairings(db, current_user.id, now)
    code = secrets.token_urlsafe(9)
    pairing = TelegramPairingCode(
        code=code,
        student_id=student.id,
        created_by=current_user.id,
        expires_at=now + timedelta(minutes=PAIRING_CODE_TTL_MINUTES),
    )
    db.add(pairing)
    await db.commit()

    return {
        "code": code,
        "deep_link": f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?start={code}",
        "expires_at": pairing.expires_at.isoformat(),
    }


@router.post("/group-setup-link")
async def create_group_setup_link(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Create the assisted `startgroup` link from variant A.

    Telegram lets the staff member create/select a group. The bot detects that
    group as a candidate; CRM requires an explicit confirmation before messages
    are associated with the student.
    """
    student_id = body.get("student_id")
    if not student_id:
        raise HTTPException(status_code=422, detail="student_id обязателен")

    student = await db.get(Student, uuid.UUID(str(student_id)))
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    await require_student_access(db, student.id, current_user)
    if not settings.TELEGRAM_BOT_USERNAME:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_USERNAME не настроен")

    now = datetime.now(timezone.utc)
    await _cancel_open_pairings(db, current_user.id, now)
    code = secrets.token_urlsafe(9)
    pairing = TelegramPairingCode(
        code=code,
        student_id=student.id,
        created_by=current_user.id,
        expires_at=now + timedelta(minutes=PAIRING_CODE_TTL_MINUTES),
    )
    db.add(pairing)
    suggested_title = await _suggested_group_title(db, student)
    record_audit(
        db,
        action=AuditAction.invite_created,
        actor=current_user,
        target_type="student",
        target_id=str(student.id),
        meta={"kind": "telegram_startgroup"},
    )
    await db.commit()
    return {
        "code": code,
        "startgroup_link": f"https://t.me/{settings.TELEGRAM_BOT_USERNAME}?startgroup={quote(code)}",
        "suggested_title": suggested_title,
        "expires_at": pairing.expires_at.isoformat(),
    }


@router.get("/pairing-candidates/{code}")
async def get_pairing_candidate(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    pairing = await _pairing_for_actor(db, code, current_user)
    return await _pairing_candidate_response(db, pairing)


@router.post("/pairing-candidates/{code}/confirm")
async def confirm_pairing_candidate(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    from app.services.telegram_bot import _bind_chat_to_pairing

    pairing = await _pairing_for_actor(db, code, current_user, lock=True)
    now = datetime.now(timezone.utc)
    if pairing.used_at:
        raise HTTPException(status_code=409, detail="Группа уже подтверждена")
    if pairing.cancelled_at:
        raise HTTPException(status_code=409, detail="Подключение отменено")
    if pairing.expires_at <= now:
        raise HTTPException(status_code=410, detail="Ссылка подключения истекла")
    if not pairing.candidate_chat_id:
        raise HTTPException(status_code=409, detail="Telegram-группа ещё не найдена")

    chat = await db.get(TelegramChat, pairing.candidate_chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Найденная группа больше недоступна")
    if chat.status != TelegramChatStatus.unbound:
        raise HTTPException(status_code=409, detail="Эта группа уже привязана")

    student = await _bind_chat_to_pairing(db, pairing, chat, now)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    record_audit(
        db,
        action=AuditAction.telegram_linked,
        actor=current_user,
        target_type="student",
        target_id=str(student.id),
        meta={"kind": "telegram_group_confirmed", "tg_chat_id": chat.chat_id},
    )
    await db.commit()
    session = await db.scalar(
        select(TelegramChatSession)
        .where(
            TelegramChatSession.chat_id == chat.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .order_by(TelegramChatSession.opened_at.desc())
        .limit(1)
    )
    return await _chat_to_dict(db, chat, session=session, current_user=current_user)


@router.post("/pairing-candidates/{code}/cancel")
async def cancel_pairing_candidate(
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    pairing = await _pairing_for_actor(db, code, current_user, lock=True)
    if pairing.used_at:
        raise HTTPException(status_code=409, detail="Подтверждённую связь нужно отвязать в карточке ученика")
    if not pairing.cancelled_at:
        pairing.cancelled_at = datetime.now(timezone.utc)
        await db.commit()
    return await _pairing_candidate_response(db, pairing)


@router.get("/{chat_id}/readiness")
async def get_group_readiness(
    chat_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Check the real Telegram state required for group ingestion."""
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")

    try:
        telegram_bot = get_bot()
        me = await telegram_bot.get_me()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Telegram-бот недоступен: {exc}")

    privacy_off = bool(getattr(me, "can_read_all_group_messages", False))
    bot_in_chat = False
    bot_is_admin = False
    can_change_info = False
    can_invite_users = False
    telegram_error = None
    live_title = chat.title

    try:
        tg_chat = await telegram_bot.get_chat(chat.chat_id)
        live_title = getattr(tg_chat, "title", None) or live_title
        member = await telegram_bot.get_chat_member(chat.chat_id, me.id)
        status = getattr(getattr(member, "status", None), "value", getattr(member, "status", None))
        bot_in_chat = status not in {None, "left", "kicked"}
        bot_is_admin = status in {"administrator", "creator"}
        can_change_info = status == "creator" or bool(getattr(member, "can_change_info", False))
        can_invite_users = status == "creator" or bool(getattr(member, "can_invite_users", False))
    except Exception as exc:
        telegram_error = str(exc)

    chat.privacy_mode_disabled = privacy_off
    if live_title:
        chat.title = live_title
    await db.commit()

    issues = []
    if not bot_in_chat:
        issues.append("Добавьте бота в группу")
    elif not bot_is_admin:
        issues.append("Назначьте бота администратором")
    else:
        if not can_change_info:
            issues.append("Разрешите боту изменять данные группы")
        if not can_invite_users:
            issues.append("Разрешите боту приглашать пользователей")
    if not privacy_off:
        issues.append("Отключите Privacy Mode через BotFather")

    return {
        "chat_id": str(chat.id),
        "telegram_chat_id": chat.chat_id,
        "title": live_title,
        "bot_in_chat": bot_in_chat,
        "bot_is_admin": bot_is_admin,
        "can_change_info": can_change_info,
        "can_invite_users": can_invite_users,
        "privacy_mode_disabled": privacy_off,
        "ready": bot_in_chat and bot_is_admin and can_change_info and can_invite_users and privacy_off,
        "issues": issues,
        "telegram_error": telegram_error,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/{chat_id}/set-title")
async def set_group_title(
    chat_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    await _require_chat_access(db, chat_id, current_user)
    chat = await db.get(TelegramChat, chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Чат не найден")
    if chat.chat_type.value not in {"group", "supergroup"}:
        raise HTTPException(status_code=409, detail="Название можно менять только у Telegram-группы")

    student_id = await _current_student_id(db, chat.id)
    student = await db.get(Student, student_id) if student_id else None
    requested_title = _clean_group_title_part(body.get("title"))
    title = requested_title or (await _suggested_group_title(db, student) if student else "")
    if not title:
        raise HTTPException(status_code=422, detail="Укажите название группы")
    if len(title) > TELEGRAM_GROUP_TITLE_MAX_LENGTH:
        raise HTTPException(status_code=422, detail="Название Telegram-группы не может быть длиннее 128 символов")

    try:
        telegram_bot = get_bot()
        me = await telegram_bot.get_me()
        member = await telegram_bot.get_chat_member(chat.chat_id, me.id)
        status = getattr(getattr(member, "status", None), "value", getattr(member, "status", None))
        is_admin = status in {"administrator", "creator"}
        can_change_info = status == "creator" or bool(getattr(member, "can_change_info", False))
        if not is_admin:
            raise HTTPException(status_code=409, detail="Сначала назначьте бота администратором группы")
        if not can_change_info:
            raise HTTPException(status_code=409, detail="Дайте боту право изменять данные группы")
        await telegram_bot.set_chat_title(chat.chat_id, title)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Telegram не изменил название группы: {exc}")

    old_title = chat.title
    chat.title = title
    await log_change(
        db,
        "telegram_chat",
        chat.id,
        "title",
        old_title,
        title,
        str(current_user.id),
    )
    await db.commit()
    return await _chat_to_dict(db, chat, current_user=current_user)


INVITE_LINK_TTL_HOURS = 72
# `member_limit=1` made Telegram invalidate the link after a single use — even
# the mentor's own test tap or the student's app double-joining — which is the
# "ссылка недействительна" students kept hitting. We instead bind the first
# valid joiner and revoke the link ourselves (telegram_bot.on_chat_member), so
# the link stays usable until a real bind happens. None = no Telegram cap.
GROUP_INVITE_MEMBER_LIMIT: int | None = None


@router.post("/invite-link")
async def create_group_invite_link(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Create a personal, single-use group invite link for a student (Приоритет 4).
    When the student joins through it, the bot binds their Telegram id to this
    student card in the background."""
    student_id = body.get("student_id")
    tg_chat_id = body.get("tg_chat_id")
    if not student_id or tg_chat_id in (None, ""):
        raise HTTPException(status_code=422, detail="student_id и tg_chat_id обязательны")

    student = await db.get(Student, uuid.UUID(str(student_id)))
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    await require_student_access(db, student.id, current_user)

    try:
        tg_chat_id_int = int(tg_chat_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="tg_chat_id должен быть числом")

    chat_result = await db.execute(select(TelegramChat).where(TelegramChat.chat_id == tg_chat_id_int))
    chat = chat_result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Telegram-группа не зарегистрирована")
    active_student_id = await _current_student_id(db, chat.id)
    if active_student_id != student.id:
        raise HTTPException(status_code=409, detail="Сначала привяжите эту группу к карточке студента")
    await _require_chat_access(db, chat.id, current_user)

    expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_LINK_TTL_HOURS)
    try:
        bot = get_bot()
        result = await bot.create_chat_invite_link(
            chat_id=tg_chat_id_int,
            member_limit=GROUP_INVITE_MEMBER_LIMIT,
            expire_date=expires_at,
            name=f"student:{student.id}",
        )
    except Exception as e:  # bot not configured / not admin / bad chat
        raise HTTPException(status_code=503, detail=f"Не удалось создать ссылку в Telegram: {e}")

    link = TelegramInviteLink(
        student_id=student.id,
        tg_chat_id=tg_chat_id_int,
        invite_link=result.invite_link,
        created_by=current_user.id,
        expires_at=expires_at,
    )
    db.add(link)
    record_audit(
        db,
        action=AuditAction.invite_created,
        actor=current_user,
        target_type="student",
        target_id=str(student.id),
        meta={"kind": "telegram_group", "tg_chat_id": tg_chat_id_int},
    )
    await db.commit()
    return {
        "invite_link": result.invite_link,
        "expires_at": expires_at.isoformat(),
        "expected_student_id": str(student.id),
        "expected_student_name": student.full_name,
    }


@router.post("/students/{student_id}/telegram/unbind")
async def unbind_student_telegram(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: StaffUser,
):
    """Cancel a wrong/auto Telegram binding on a student card (Приоритет 4)."""
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    await require_student_access(db, student.id, current_user)

    prev = student.telegram_user_id
    student.telegram_user_id = None
    student.telegram_username = None
    student.telegram_linked_at = None
    record_audit(
        db,
        action=AuditAction.telegram_unlinked,
        actor=current_user,
        target_type="student",
        target_id=str(student.id),
        meta={"prev_tg_user_id": prev},
    )
    await db.commit()
    return {"ok": True}


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

    student = None
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
        "onboarding_message_id": chat.onboarding_message_id,
        "onboarding_text": chat.onboarding_text,
        "onboarding_updated_at": chat.onboarding_updated_at.isoformat() if chat.onboarding_updated_at else None,
        "status": chat.status.value,
        "privacy_mode_disabled": chat.privacy_mode_disabled,
        "created_at": chat.created_at.isoformat(),
        "session_id": str(session.id) if session else None,
        "student_id": str(session.student_id) if session and session.student_id else None,
        "student_name": student_name,
        "student_telegram_user_id": student.telegram_user_id if student else None,
        "student_telegram_username": student.telegram_username if student else None,
        "student_telegram_linked_at": student.telegram_linked_at.isoformat() if student and student.telegram_linked_at else None,
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


async def _message_to_dict(
    m: TelegramMessage,
    identity: TelegramParticipantIdentity | None = None,
    current_user_id: uuid.UUID | None = None,
) -> dict:
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
        "sender_tg_id": m.sender_tg_id,
        "sender_name": m.sender_name,
        "sender_role": "staff" if m.sent_by_user_id else identity.role if identity else "unknown",
        "sender_display_name": m.sender_name if m.sent_by_user_id else identity.display_name if identity else m.sender_name,
        "is_current_user": bool(
            (m.sent_by_user_id and current_user_id and m.sent_by_user_id == current_user_id)
            or (identity and current_user_id and identity.user_id == current_user_id)
        ),
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


def _import_update_id(chat_tg_id: int, telegram_message_id: int) -> int:
    digest = hashlib.blake2b(f"{chat_tg_id}:{telegram_message_id}".encode("utf-8"), digest_size=7).hexdigest()
    return -int(digest, 16)


def _telegram_export_text(raw_text) -> str:
    if isinstance(raw_text, str):
        return raw_text.strip()
    if isinstance(raw_text, list):
        chunks: list[str] = []
        for item in raw_text:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict):
                chunks.append(str(item.get("text") or ""))
        return "".join(chunks).strip()
    return ""


def _telegram_export_sender_id(raw_from_id) -> int | None:
    if raw_from_id is None:
        return None
    match = re.search(r"-?\d+", str(raw_from_id))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _telegram_export_datetime(raw: dict) -> datetime:
    raw_unixtime = raw.get("date_unixtime")
    if raw_unixtime is not None:
        try:
            return datetime.fromtimestamp(int(str(raw_unixtime)), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            pass
    raw_date = raw.get("date")
    if isinstance(raw_date, str):
        try:
            parsed = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _telegram_export_attachment_label(raw: dict) -> str:
    for key in ("file", "photo", "thumbnail"):
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    media_type = str(raw.get("media_type") or "").strip()
    if media_type:
        return media_type
    return ""


def _telegram_export_message_type(raw: dict) -> TelegramMessageType:
    media_type = str(raw.get("media_type") or "").lower()
    if raw.get("photo") or "photo" in media_type:
        return TelegramMessageType.photo
    if raw.get("file") or "document" in media_type or "file" in media_type:
        return TelegramMessageType.document
    if "voice" in media_type:
        return TelegramMessageType.voice
    if "video" in media_type:
        return TelegramMessageType.video_note
    if _telegram_export_text(raw.get("text")):
        return TelegramMessageType.text
    return TelegramMessageType.other


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
