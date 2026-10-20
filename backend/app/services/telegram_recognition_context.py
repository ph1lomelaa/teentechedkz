"""Bounded, chronological context; roles come from records, never display names."""
from __future__ import annotations

import json
from sqlalchemy import and_, or_, select
from app.models.telegram_message import TelegramMessage
from app.models.telegram_participant_identity import TelegramParticipantIdentity
from app.models.user import User, UserRole
from app.models.student import Student

STAFF_ROLES = {"mentor", "staff", "admin", "mzk_manager", "academic_head", "sales", "manager", "supervisor"}
MAX_CONTEXT_MESSAGES = 16
MAX_MESSAGE_CHARS = 4000


async def message_roles(db, messages: list[TelegramMessage], *, student_id=None) -> dict:
    if not messages:
        return {}
    chat_ids = {m.chat_id for m in messages}
    tg_ids = {m.sender_tg_id for m in messages if m.sender_tg_id is not None}
    identities = []
    if tg_ids:
        identities = (await db.execute(select(TelegramParticipantIdentity).where(
            TelegramParticipantIdentity.chat_id.in_(chat_ids),
            TelegramParticipantIdentity.telegram_user_id.in_(tg_ids),
        ))).scalars().all()
    user_ids = {m.sent_by_user_id for m in messages if m.sent_by_user_id}
    user_ids.update(i.user_id for i in identities if i.user_id)
    users = []
    if tg_ids or user_ids:
        users = (await db.execute(select(User).where(or_(
            User.id.in_(user_ids), User.telegram_id.in_([str(i) for i in tg_ids]),
        )))).scalars().all()
    student_by_user = {}
    student_users = [u.id for u in users if u.role == UserRole.student]
    if student_id and student_users:
        linked_students = (await db.execute(select(Student).where(Student.user_id.in_(student_users)))).scalars().all()
        student_by_user = {s.user_id: s.id for s in linked_students}
    by_id = {u.id: u for u in users}
    by_tg = {u.telegram_id: u for u in users if u.telegram_id}
    by_participant = {(i.chat_id, i.telegram_user_id): i for i in identities}
    roles = {}
    for m in messages:
        payload = m.raw_payload or {}
        sender = payload.get('from_user') or payload.get('from') or {}
        identity = by_participant.get((m.chat_id, m.sender_tg_id))
        user = by_id.get(m.sent_by_user_id) or by_tg.get(str(m.sender_tg_id)) or (by_id.get(identity.user_id) if identity else None)
        if isinstance(sender, dict) and sender.get('is_bot'):
            role = 'bot'
        elif user:
            role = 'student' if user.role == UserRole.student else 'staff'
        elif m.sent_by_user_id:
            role = 'staff'
        elif identity and identity.role in STAFF_ROLES:
            role = 'staff'
        else:
            role = identity.role if identity and identity.role in {'student', 'parent', 'guardian'} else 'unknown'
        known_student = student_by_user.get(user.id) if user and user.role == UserRole.student else (identity.student_id if identity else None)
        if student_id and role not in {'staff', 'bot'} and known_student and known_student != student_id:
            role = 'other_student'
        roles[m.id] = role
    return roles


async def format_context(db, messages: list[TelegramMessage], *, max_chars: int = 24000, student_id=None) -> str:
    selected = []
    size = 0
    for message in reversed(messages):
        length = min(len(message.raw_text or ""), MAX_MESSAGE_CHARS)
        if selected and size + length > max_chars:
            break
        selected.append(message)
        size += length
    messages = list(reversed(selected))
    roles = await message_roles(db, messages, student_id=student_id)
    rows = [{
        'message_id': str(m.id), 'created_at': m.created_at.isoformat() if m.created_at else None,
        'sender_name': m.sender_name, 'sender_role': roles[m.id],
        'text': (m.raw_text or '')[:MAX_MESSAGE_CHARS],
    } for m in messages]
    return json.dumps(rows, ensure_ascii=False)


async def preceding_context(db, message: TelegramMessage, *, student_id=None) -> str:
    # Same session means same student binding. A reused group must never leak a
    # previous student's dialog; delayed worker jobs must not read future facts.
    rows = (await db.execute(select(TelegramMessage).where(
        TelegramMessage.chat_id == message.chat_id,
        TelegramMessage.session_id == message.session_id,
        or_(TelegramMessage.created_at < message.created_at,
            and_(TelegramMessage.created_at == message.created_at, TelegramMessage.id <= message.id)),
    ).order_by(TelegramMessage.created_at.desc(), TelegramMessage.id.desc()).limit(MAX_CONTEXT_MESSAGES))).scalars().all()
    return await format_context(db, list(reversed(rows)), max_chars=16000, student_id=student_id)
