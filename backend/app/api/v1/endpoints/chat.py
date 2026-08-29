"""In-app chat (student ↔ mentor) + notifications, pushed over WebSocket.

Sending goes through REST; the WebSocket is server→client push only
(new messages, new notifications). Fan-out to the right socket, regardless
of which uvicorn worker process holds it, goes through app.services.ws_hub
(Redis pub/sub-backed).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select, func, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, allows, require_access
from app.core.audit import log_change
from app.core.security import decode_access_token
from app.core.uploads import read_upload_capped
from app.services.mentor_scope import require_student_access
from app.services.ws_hub import manager
from app.models.user import User, UserRole
from app.models.student import Student
from app.models.mentor_assignment import MentorAssignment
from app.models.roadmap import Roadmap, RoadmapStatus
from app.models.chat import Conversation, ConversationMember, Message, MessageAttachment, ConversationType
from app.models.document import Document, DocSource, DocType
from app.models.notification import Notification
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.student_task import StudentTask, TaskStatus
from app.core.config import settings
from app.services.minio_service import close_minio_object, get_minio, minio_delete, minio_upload
from app.services.student_notes import snapshot_student

router = APIRouter(tags=["chat"])

_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_NOT_FOUND = HTTPException(status_code=404, detail="Не найдено")
CHAT_ATTACHMENT_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024


class SendMessageBody(BaseModel):
    body: str


class StartConversationBody(BaseModel):
    user_id: uuid.UUID


def _attachment_to_dict(attachment: MessageAttachment) -> dict:
    return {
        "id": str(attachment.id),
        "document_id": str(attachment.document_id) if attachment.document_id else None,
        "file_name": attachment.file_name,
        "file_size": attachment.file_size,
        "mime_type": attachment.mime_type,
        "created_at": attachment.created_at.isoformat(),
    }


def _message_to_dict(message: Message) -> dict:
    return {
        "id": str(message.id),
        "sender_id": str(message.sender_id),
        "body": message.body,
        "created_at": message.created_at.isoformat(),
        "attachments": [_attachment_to_dict(attachment) for attachment in message.attachments],
    }


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _user_brief(db: AsyncSession, user_id: uuid.UUID) -> dict | None:
    u = await db.get(User, user_id)
    if not u:
        return None
    return {"id": str(u.id), "name": u.name, "role": u.role.value}


async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


async def _is_member(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    res = await db.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conv_id,
            ConversationMember.user_id == user_id,
        )
    )
    return res.scalar_one_or_none() is not None


async def _member_ids(db: AsyncSession, conv_id: uuid.UUID) -> list[uuid.UUID]:
    res = await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conv_id))
    return [r[0] for r in res.all()]


async def _conversation_student(db: AsyncSession, conv_id: uuid.UUID) -> Student | None:
    res = await db.execute(
        select(Student)
        .join(ConversationMember, ConversationMember.user_id == Student.user_id)
        .where(
            ConversationMember.conversation_id == conv_id,
            Student.user_id.is_not(None),
        )
        .limit(1)
    )
    return res.scalar_one_or_none()


async def _can_preview_conversation(db: AsyncSession, conv_id: uuid.UUID, user: User) -> bool:
    if await _is_member(db, conv_id, user.id):
        return True
    if not allows(resource="chat", action=Action.manage, role=user.role):
        return False
    return await _conversation_student(db, conv_id) is not None


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
        await db.commit()
    except IntegrityError:
        await db.rollback()
        res = await db.execute(select(Conversation).where(Conversation.direct_key == key))
        conv = res.scalar_one_or_none()
        if not conv:
            raise
    await db.refresh(conv)
    return conv


# --------------------------------------------------------------------------
# Contacts (who a user can start a chat with)
# --------------------------------------------------------------------------
@router.get("/portal/contacts")
async def portal_contacts(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """A student's mentors — the people they can message."""
    require_access(current_user, "portal", Action.view)
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    res = await db.execute(
        select(User)
        .join(MentorAssignment, MentorAssignment.mentor_id == User.id)
        .where(MentorAssignment.student_id == sid, MentorAssignment.is_active == True)  # noqa: E712
        .distinct()
    )
    users_by_id = {u.id: u for u in res.scalars().all()}
    roadmap_mentor = await db.execute(
        select(User)
        .join(Roadmap, Roadmap.mentor_id == User.id)
        .where(
            Roadmap.student_id == sid,
            Roadmap.status == RoadmapStatus.active,
            Roadmap.mentor_id.isnot(None),
        )
        .limit(1)
    )
    mentor = roadmap_mentor.scalar_one_or_none()
    if mentor:
        users_by_id[mentor.id] = mentor
    return [{"id": str(u.id), "name": u.name, "role": u.role.value} for u in users_by_id.values()]


# --------------------------------------------------------------------------
# Conversations
# --------------------------------------------------------------------------
@router.get("/conversations")
async def list_conversations(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
):
    target_user_id = current_user.id
    preview_mode = False
    if mentor_id:
        if current_user.role == UserRole.mentor and mentor_id != current_user.id:
            raise _FORBIDDEN
        if allows(resource="chat", action=Action.manage, role=current_user.role):
            mentor = await db.get(User, mentor_id)
            if not mentor or mentor.role != UserRole.mentor:
                raise HTTPException(status_code=404, detail="Ментор не найден")
            target_user_id = mentor_id
            preview_mode = target_user_id != current_user.id
        elif current_user.role == UserRole.mentor:
            target_user_id = current_user.id

    res = await db.execute(
        select(ConversationMember).where(ConversationMember.user_id == target_user_id)
    )
    my_memberships = res.scalars().all()
    out = []
    for mem in my_memberships:
        conv = await db.get(Conversation, mem.conversation_id)
        if not conv:
            continue
        student = await _conversation_student(db, conv.id)
        if preview_mode and not student:
            continue
        member_ids = await _member_ids(db, conv.id)
        other_id = next((mid for mid in member_ids if mid != target_user_id), None)
        other = await _user_brief(db, other_id) if other_id else None

        last_res = await db.execute(
            select(Message).where(Message.conversation_id == conv.id).order_by(Message.created_at.desc()).limit(1)
        )
        last = last_res.scalar_one_or_none()

        unread_res = await db.execute(
            select(func.count(Message.id)).where(
                Message.conversation_id == conv.id,
                Message.sender_id != current_user.id,
                Message.created_at > mem.last_read_at,
            )
        )
        unread = unread_res.scalar_one()

        out.append({
            "id": str(conv.id),
            "type": conv.type.value,
            "title": conv.title,
            "other": other,
            "unread": unread,
            "last_message": (
                {"body": last.body, "created_at": last.created_at.isoformat(), "sender_id": str(last.sender_id)}
                if last else None
            ),
            "updated_at": (last.created_at if last else conv.created_at).isoformat(),
            "student": (
                {"id": str(student.id), "full_name": student.full_name, "user_id": str(student.user_id)}
                if student else None
            ),
            "can_write": await _is_member(db, conv.id, current_user.id),
        })
    out.sort(key=lambda c: c["updated_at"], reverse=True)
    return out


@router.post("/conversations")
async def start_conversation(body: StartConversationBody, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """Student starts a chat with one of their mentors."""
    require_access(current_user, "portal", Action.view)
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    ok = await db.execute(
        select(MentorAssignment).where(
            MentorAssignment.student_id == sid,
            MentorAssignment.mentor_id == body.user_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
    )
    if not ok.scalar_one_or_none():
        raise _FORBIDDEN
    conv = await _get_or_create_direct(db, current_user.id, body.user_id, current_user.id)
    return {"id": str(conv.id)}


@router.post("/students/{student_id}/conversation")
async def staff_conversation(student_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """Staff opens (or reuses) a direct chat with a student's portal account."""
    require_access(current_user, "chat", Action.manage)
    await require_student_access(db, student_id, current_user)
    student = await db.get(Student, student_id)
    if not student or not student.user_id:
        raise HTTPException(status_code=409, detail="У студента нет доступа в кабинет")
    conv = await _get_or_create_direct(db, current_user.id, student.user_id, current_user.id)
    return {"id": str(conv.id)}


@router.get("/conversations/{conv_id}/messages")
async def list_messages(conv_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if not await _can_preview_conversation(db, conv_id, current_user):
        raise _NOT_FOUND
    res = await db.execute(
        select(Message)
        .options(selectinload(Message.attachments))
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.asc())
    )
    return [_message_to_dict(message) for message in res.scalars().all()]


@router.post("/conversations/{conv_id}/messages")
async def send_message(conv_id: uuid.UUID, body: SendMessageBody, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if not await _is_member(db, conv_id, current_user.id):
        raise _NOT_FOUND
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Пустое сообщение")

    msg = Message(conversation_id=conv_id, sender_id=current_user.id, body=text)
    db.add(msg)
    # sender has read up to their own message
    await db.execute(
        ConversationMember.__table__.update()
        .where(and_(ConversationMember.conversation_id == conv_id, ConversationMember.user_id == current_user.id))
        .values(last_read_at=_now())
    )
    await db.commit()
    await db.refresh(msg)

    member_ids = await _member_ids(db, conv_id)
    payload = {
        "conversation_id": str(conv_id),
        # This newly inserted message has no attachments.  Serialize it
        # explicitly instead of triggering an async lazy-load on the ORM
        # relationship after commit.
        "message": {
            "id": str(msg.id),
            "sender_id": str(msg.sender_id),
            "body": msg.body,
            "created_at": msg.created_at.isoformat(),
            "attachments": [],
        },
    }
    await manager.send_to_users([str(m) for m in member_ids], "message.new", payload)

    # notify the other members
    others = [m for m in member_ids if m != current_user.id]
    preview = text if len(text) <= 80 else text[:77] + "…"
    for uid in others:
        note = Notification(user_id=uid, kind="message", title=f"Сообщение от {current_user.name}", body=preview, link="/portal/chat")
        db.add(note)
        await db.commit()
        await db.refresh(note)
        await manager.send_to_users([str(uid)], "notification.new", {
            "id": str(note.id), "kind": note.kind, "title": note.title, "body": note.body,
            "link": note.link, "is_read": False, "priority": note.priority, "created_at": note.created_at.isoformat(),
        })

    return payload["message"]


async def _internal_message_for_action(
    db: AsyncSession,
    conv_id: uuid.UUID,
    message_id: uuid.UUID,
    current_user: User,
) -> tuple[Message, Student]:
    require_access(current_user, "chat", Action.manage)
    if not await _can_preview_conversation(db, conv_id, current_user):
        raise _NOT_FOUND
    message = await db.get(Message, message_id)
    if not message or message.conversation_id != conv_id:
        raise _NOT_FOUND
    student = await _conversation_student(db, conv_id)
    if not student:
        raise HTTPException(status_code=422, detail="Диалог не связан со студентом")
    await require_student_access(db, student.id, current_user)
    return message, student


@router.post("/conversations/{conv_id}/messages/{message_id}/task")
async def create_task_from_internal_message(
    conv_id: uuid.UUID,
    message_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    message, student = await _internal_message_for_action(db, conv_id, message_id, current_user)
    task_text = str(body.get("task_text") or message.body).strip()
    if not task_text:
        raise HTTPException(status_code=422, detail="Текст задачи пуст")
    task = StudentTask(
        student_id=student.id,
        task_text=task_text,
        created_by=current_user.id,
        status=TaskStatus.open,
    )
    db.add(task)
    await db.flush()
    await log_change(
        db, "student_task", task.id, "created_from_message", None, str(message.id),
        str(current_user.id), source="workspace_internal_chat",
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


@router.post("/conversations/{conv_id}/messages/{message_id}/note")
async def create_note_from_internal_message(
    conv_id: uuid.UUID,
    message_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    message, student = await _internal_message_for_action(db, conv_id, message_id, current_user)
    title = str(body.get("title") or "Заметка из внутреннего чата").strip()
    source_text = message.body.strip() or "Вложение из внутреннего чата"
    note = StudentNote(
        student_id=student.id,
        title=title,
        source_text=source_text,
        summary_markdown=f"## {title}\n\n{source_text}",
        profile_snapshot=snapshot_student(student),
        suggested_changes={},
        applied_changes={},
        status=StudentNoteStatus.draft,
        created_by=current_user.id,
    )
    db.add(note)
    await db.flush()
    await log_change(
        db, "student_note", note.id, "created_from_message", None, str(message.id),
        str(current_user.id), source="workspace_internal_chat",
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


@router.post("/conversations/{conv_id}/attachments")
async def send_attachment(
    conv_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: UploadFile = File(...),
    doc_type: str = Form("other"),
):
    if not await _is_member(db, conv_id, current_user.id):
        raise _NOT_FOUND
    student = await _conversation_student(db, conv_id)
    if not student:
        raise HTTPException(status_code=422, detail="Диалог не связан со студентом")
    content = await read_upload_capped(file, CHAT_ATTACHMENT_MAX_BYTES)
    if not content:
        raise HTTPException(status_code=422, detail="Пустой файл")
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in CHAT_ATTACHMENT_MIME_TYPES:
        raise HTTPException(status_code=422, detail=f"Недопустимый тип файла: {mime_type}")
    try:
        parsed_doc_type = DocType(doc_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Неверный doc_type") from exc

    file_name = file.filename or "attachment"
    attachment_path = await minio_upload(content, student.id, f"chat_{file_name}", mime_type)
    document_path = await minio_upload(content, student.id, file_name, mime_type)
    try:
        document = Document(
            student_id=student.id,
            uploaded_by=current_user.id,
            doc_type=parsed_doc_type,
            file_name=file_name,
            file_size=len(content),
            mime_type=mime_type,
            storage_path=document_path,
            source=DocSource.manual_upload,
        )
        db.add(document)
        await db.flush()
        message = Message(
            conversation_id=conv_id,
            sender_id=current_user.id,
            body=f"📎 {file_name}",
        )
        db.add(message)
        await db.flush()
        attachment = MessageAttachment(
            message_id=message.id,
            document_id=document.id,
            file_name=file_name,
            file_size=len(content),
            mime_type=mime_type,
            storage_path=attachment_path,
        )
        db.add(attachment)
        await log_change(
            db, "document", document.id, "created_from_message", None, str(message.id),
            str(current_user.id), source="workspace_internal_chat",
        )
        await db.execute(
            ConversationMember.__table__.update()
            .where(and_(ConversationMember.conversation_id == conv_id, ConversationMember.user_id == current_user.id))
            .values(last_read_at=_now())
        )
        await db.commit()
        await db.refresh(message)
        await db.refresh(attachment)
    except Exception:
        await db.rollback()
        await minio_delete(attachment_path)
        await minio_delete(document_path)
        raise

    payload = {
        "conversation_id": str(conv_id),
        "message": {
            "id": str(message.id),
            "sender_id": str(message.sender_id),
            "body": message.body,
            "created_at": message.created_at.isoformat(),
            "attachments": [_attachment_to_dict(attachment)],
        },
    }
    member_ids = await _member_ids(db, conv_id)
    await manager.send_to_users([str(member_id) for member_id in member_ids], "message.new", payload)
    for user_id in [member_id for member_id in member_ids if member_id != current_user.id]:
        notification = Notification(
            user_id=user_id,
            kind="message",
            title=f"Файл от {current_user.name}",
            body=file_name,
            link="/portal/chat",
        )
        db.add(notification)
    await db.commit()
    return payload["message"]


@router.get("/message-attachments/{attachment_id}/download")
async def download_message_attachment(
    attachment_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    attachment = await db.get(MessageAttachment, attachment_id)
    if not attachment:
        raise _NOT_FOUND
    message = await db.get(Message, attachment.message_id)
    if not message or not await _can_preview_conversation(db, message.conversation_id, current_user):
        raise _NOT_FOUND
    client = get_minio()
    try:
        obj = client.get_object(settings.MINIO_BUCKET_NAME, attachment.storage_path)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Файл не найден в хранилище") from exc
    return StreamingResponse(
        obj,
        media_type=attachment.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{attachment.file_name}"'},
        background=BackgroundTask(close_minio_object, obj),
    )


@router.post("/conversations/{conv_id}/read", status_code=204)
async def mark_read(conv_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if not await _is_member(db, conv_id, current_user.id):
        # Персонал, смотрящий чужую переписку в режиме просмотра, молча
        # ничего не отмечает — 403 тут был бы шумом.
        if allows(
            resource="chat", action=Action.manage, role=current_user.role
        ) and await _conversation_student(db, conv_id):
            return
        raise _NOT_FOUND
    await db.execute(
        ConversationMember.__table__.update()
        .where(and_(ConversationMember.conversation_id == conv_id, ConversationMember.user_id == current_user.id))
        .values(last_read_at=_now())
    )
    await db.commit()


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------
@router.get("/notifications")
async def list_notifications(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    res = await db.execute(
        select(Notification).where(Notification.user_id == current_user.id).order_by(Notification.created_at.desc()).limit(50)
    )
    items = [
        {"id": str(n.id), "kind": n.kind, "title": n.title, "body": n.body, "link": n.link,
         "is_read": n.is_read, "priority": n.priority, "created_at": n.created_at.isoformat()}
        for n in res.scalars().all()
    ]
    unread = sum(1 for i in items if not i["is_read"])
    return {"items": items, "unread": unread}


@router.post("/notifications/read-all", status_code=204)
async def read_all_notifications(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    await db.execute(
        Notification.__table__.update().where(Notification.user_id == current_user.id).values(is_read=True)
    )
    await db.commit()


@router.post("/notifications/{notification_id}/read", status_code=204)
async def read_notification(
    notification_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await db.execute(
        Notification.__table__.update()
        .where(Notification.id == notification_id, Notification.user_id == current_user.id)
        .values(is_read=True)
    )
    await db.commit()


# --------------------------------------------------------------------------
# WebSocket (server → client push)
# --------------------------------------------------------------------------
@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
    except Exception:
        await ws.close(code=1008)
        return
    if not user_id:
        await ws.close(code=1008)
        return

    await manager.connect(user_id, ws)
    try:
        while True:
            # We don't process inbound frames (sending is via REST); this keeps
            # the socket open and detects disconnects.
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(user_id, ws)
    except Exception:
        await manager.disconnect(user_id, ws)
