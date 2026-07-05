from __future__ import annotations
import uuid
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.document import Document, DocType, DocSource
from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage
from app.models.user import UserRole
from app.services.mentor_scope import require_student_access
from app.services.minio_service import (
    close_minio_object,
    get_minio,
    minio_copy_to_student,
    minio_delete,
    minio_upload,
)

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


@router.post("/student/{student_id}")
async def upload_document(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    doc_type: str = Form(...),
    file: UploadFile = File(...),
):
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Файл слишком большой (макс. 25 МБ)")

    try:
        import magic
        mime = magic.from_buffer(content, mime=True)
    except Exception:
        mime = file.content_type or "application/octet-stream"

    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=422, detail=f"Недопустимый тип файла: {mime}")

    try:
        dtype = DocType(doc_type)
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверный doc_type")

    storage_path = await minio_upload(
        content=content,
        student_id=student_id,
        filename=file.filename or "upload",
        mime_type=mime,
    )

    doc = Document(
        student_id=student_id,
        uploaded_by=current_user.id,
        doc_type=dtype,
        file_name=file.filename or "upload",
        file_size=len(content),
        mime_type=mime,
        storage_path=storage_path,
        source=DocSource.manual_upload,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return _doc_to_dict(doc)


@router.post("/from-telegram/{attachment_id}")
async def save_telegram_attachment_as_document(
    attachment_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    doc_type: str = Form(...),
):
    attachment = await db.get(TelegramAttachment, attachment_id)
    if not attachment:
        raise HTTPException(status_code=404, detail="Вложение не найдено")
    if attachment.status not in (TelegramAttachmentStatus.downloaded, TelegramAttachmentStatus.parsed):
        raise HTTPException(status_code=409, detail="Файл ещё не загружен ботом")
    if not attachment.storage_path:
        raise HTTPException(status_code=409, detail="Файл ещё не загружен ботом")

    message = await db.get(TelegramMessage, attachment.message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")

    student_id: uuid.UUID | None = None
    if message.session_id:
        session = await db.get(TelegramChatSession, message.session_id)
        if session:
            student_id = session.student_id
    if student_id is None:
        result = await db.execute(
            select(TelegramChatSession.student_id)
            .where(
                TelegramChatSession.chat_id == message.chat_id,
                TelegramChatSession.status == TelegramSessionStatus.active,
            )
            .order_by(TelegramChatSession.opened_at.desc())
            .limit(1)
        )
        row = result.first()
        student_id = row[0] if row else None

    if student_id is None:
        raise HTTPException(status_code=422, detail="Чат не привязан к студенту")

    await require_student_access(db, student_id, current_user)

    try:
        dtype = DocType(doc_type)
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверный doc_type")

    # object names look like "<dir>/<uuid>_<original filename>" — strip the
    # uuid prefix so the Document shows a clean, recognizable file name.
    object_tail = attachment.storage_path.rsplit("/", 1)[-1]
    _prefix, _, rest = object_tail.partition("_")
    filename = rest or object_tail
    new_path = await minio_copy_to_student(attachment.storage_path, student_id, filename)

    doc = Document(
        student_id=student_id,
        uploaded_by=current_user.id,
        doc_type=dtype,
        file_name=filename,
        file_size=attachment.file_size or 0,
        mime_type=attachment.mime_type or "application/octet-stream",
        storage_path=new_path,
        source=DocSource.telegram,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return _doc_to_dict(doc)


@router.patch("/{doc_id}/verify")
async def verify_document(
    doc_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    doc.is_verified = True
    await db.commit()
    await db.refresh(doc)
    return _doc_to_dict(doc)


@router.get("/{doc_id}/download")
async def download_document(
    doc_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    client = get_minio()
    obj = client.get_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=doc.storage_path,
    )

    # HTTP headers are latin-1 only — file names with Cyrillic (or any
    # non-ASCII) characters crash StreamingResponse if interpolated directly.
    # RFC 5987's filename* covers that; the plain ASCII fallback is for
    # older clients that don't parse filename*.
    ascii_fallback = doc.file_name.encode("ascii", "ignore").decode("ascii") or "file"
    headers = {
        "Content-Disposition": (
            f'inline; filename="{ascii_fallback}"; '
            f"filename*=UTF-8''{quote(doc.file_name)}"
        ),
        "X-Content-Type-Options": "nosniff",
    }
    return StreamingResponse(
        obj,
        media_type=doc.mime_type or "application/octet-stream",
        headers=headers,
        background=BackgroundTask(close_minio_object, obj),
    )


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    storage_path = doc.storage_path
    await db.delete(doc)
    await db.commit()
    if storage_path:
        try:
            await minio_delete(storage_path)
        except Exception:
            pass
    return {"ok": True}


def _doc_to_dict(d: Document) -> dict:
    return {
        "id": str(d.id),
        "student_id": str(d.student_id),
        "uploaded_by": str(d.uploaded_by),
        "doc_type": d.doc_type.value,
        "file_name": d.file_name,
        "file_size": d.file_size,
        "mime_type": d.mime_type,
        "storage_path": d.storage_path,
        "source": d.source.value,
        "ai_description": d.ai_description,
        "ai_doc_type_confidence": float(d.ai_doc_type_confidence) if d.ai_doc_type_confidence else None,
        "is_verified": d.is_verified,
        "uploaded_at": d.uploaded_at.isoformat(),
    }
