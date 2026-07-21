from __future__ import annotations
import logging
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
from app.core.audit import log_change
from app.models.document import Document, DocType, DocSource
from app.models.student import Student
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
logger = logging.getLogger(__name__)

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
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    await require_student_access(db, student_id, current_user)

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
    try:
        await db.flush()
        await log_change(
            db, "document", doc.id, "created", None, doc.file_name,
            str(current_user.id), source="workspace_upload",
        )
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await minio_delete(storage_path)
        except Exception:
            logger.exception("Failed to clean up uploaded document object %s after DB error", storage_path)
        raise
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

    existing_result = await db.execute(
        select(Document).where(Document.source_telegram_attachment_id == attachment.id)
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return _doc_to_dict(existing)

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
        source_telegram_attachment_id=attachment.id,
        # Документ, пришедший из Telegram, сразу виден и в CRM, и в кабинете
        # ученика (п.2) — как файл, которым обменялись в переписке.
        visible_to_student=True,
    )
    db.add(doc)
    await db.flush()
    await log_change(
        db, "document", doc.id, "created_from_telegram", None, attachment.id,
        str(current_user.id), source="workspace_telegram",
    )
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

    # Students may only download their own documents that are shared to the portal.
    if current_user.role == UserRole.student:
        if doc.student_id != await _my_student_id(db, current_user) or not doc.visible_to_student:
            raise HTTPException(status_code=404, detail="Документ не найден")
    else:
        await require_student_access(db, doc.student_id, current_user)

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
            logger.exception("Failed to delete MinIO object for document %s: %s", doc_id, storage_path)
    return {"ok": True}


async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


@router.patch("/{doc_id}/visibility")
async def set_visibility(
    doc_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Staff toggle whether a document is shared to the student's portal."""
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    await require_student_access(db, doc.student_id, current_user)  # mentor scope
    old_value = doc.visible_to_student
    doc.visible_to_student = bool(body.get("visible_to_student", False))
    await log_change(
        db, "document", doc.id, "visible_to_student", old_value, doc.visible_to_student,
        str(current_user.id), source="workspace_documents",
    )
    await db.commit()
    await db.refresh(doc)
    return _doc_to_dict(doc)


@router.patch("/{doc_id}/type")
async def set_document_type(
    doc_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
    doc = await db.get(Document, doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    await require_student_access(db, doc.student_id, current_user)
    old_type = doc.doc_type.value
    try:
        doc.doc_type = DocType(str(body.get("doc_type")))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Неверный doc_type") from exc
    await log_change(
        db, "document", doc.id, "doc_type", old_type, doc.doc_type.value,
        str(current_user.id), source="workspace_documents",
    )
    await db.commit()
    await db.refresh(doc)
    return _doc_to_dict(doc)


@router.get("/portal/mine")
async def my_documents(db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    """Documents the student can see in their portal."""
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Access denied")
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    result = await db.execute(
        select(Document)
        .where(Document.student_id == sid, Document.visible_to_student == True)  # noqa: E712
        .order_by(Document.uploaded_at.desc())
    )
    return [_doc_to_dict(d) for d in result.scalars().all()]


@router.get("/portal/{doc_id}/download")
async def portal_download_document(
    doc_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Download a document from the student's portal."""
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Access denied")

    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")

    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc or doc.student_id != sid or not doc.visible_to_student:
        raise HTTPException(status_code=404, detail="Документ не найден")

    client = get_minio()
    obj = client.get_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=doc.storage_path,
    )

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


@router.post("/portal/upload")
async def portal_upload(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    doc_type: str = Form("other"),
    file: UploadFile = File(...),
):
    """Student uploads a document to their own portal (visible by default)."""
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Access denied")
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")

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
        dtype = DocType.other

    storage_path = await minio_upload(content=content, student_id=sid, filename=file.filename or "upload", mime_type=mime)
    doc = Document(
        student_id=sid, uploaded_by=current_user.id, doc_type=dtype,
        file_name=file.filename or "upload", file_size=len(content), mime_type=mime,
        storage_path=storage_path, source=DocSource.manual_upload, visible_to_student=True,
    )
    db.add(doc)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await minio_delete(storage_path)
        except Exception:
            logger.exception("Failed to clean up portal upload %s after DB error", storage_path)
        raise
    await db.refresh(doc)
    return _doc_to_dict(doc)


@router.delete("/portal/{doc_id}")
async def portal_delete_document(
    doc_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Student deletes their own manually uploaded document."""
    if current_user.role != UserRole.student:
        raise HTTPException(status_code=403, detail="Access denied")
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")

    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc or doc.student_id != sid or doc.source != DocSource.manual_upload:
        raise HTTPException(status_code=404, detail="Документ не найден")

    storage_path = doc.storage_path
    await db.delete(doc)
    await db.commit()
    if storage_path:
        try:
            await minio_delete(storage_path)
        except Exception:
            logger.exception("Failed to delete MinIO object for document %s: %s", doc_id, storage_path)
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
        "visible_to_student": d.visible_to_student,
        "uploaded_at": d.uploaded_at.isoformat(),
    }
