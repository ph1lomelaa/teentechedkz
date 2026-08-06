from __future__ import annotations
import logging
import uuid
from io import BytesIO
from urllib.parse import urlparse, urlunparse

from minio import Minio
from minio.error import S3Error

from app.core.config import settings

logger = logging.getLogger(__name__)
_client: Minio | None = None


def get_minio() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_USE_SSL,
        )
        _ensure_bucket(_client)
    return _client


def _ensure_bucket(client: Minio) -> None:
    try:
        if not client.bucket_exists(settings.MINIO_BUCKET_NAME):
            client.make_bucket(settings.MINIO_BUCKET_NAME)
    except S3Error:
        logger.exception("Failed to ensure MinIO bucket exists: %s", settings.MINIO_BUCKET_NAME)
        raise


async def minio_upload(
    content: bytes,
    student_id: uuid.UUID,
    filename: str,
    mime_type: str,
) -> str:
    client = get_minio()
    file_id = str(uuid.uuid4())
    safe_name = filename.replace(" ", "_")
    object_name = f"students/{student_id}/{file_id}_{safe_name}"

    client.put_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        data=BytesIO(content),
        length=len(content),
        content_type=mime_type,
    )
    return object_name


async def minio_upload_raw(
    content: bytes,
    chat_id: uuid.UUID,
    filename: str,
    mime_type: str,
) -> str:
    """Stores a Telegram attachment before it's linked to a student.

    Unbound chats have no student_id yet, so these live under a chat-scoped
    path and get copied into students/{id}/... once a manager approves them.
    """
    client = get_minio()
    file_id = str(uuid.uuid4())
    safe_name = filename.replace(" ", "_")
    object_name = f"telegram_chats/{chat_id}/{file_id}_{safe_name}"

    client.put_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        data=BytesIO(content),
        length=len(content),
        content_type=mime_type,
    )
    return object_name


async def minio_upload_note_audio(
    content: bytes,
    session_id: uuid.UUID,
    filename: str,
    mime_type: str,
) -> str:
    """Stores a ~5-minute local recording segment uploaded as a safety net
    alongside the live Deepgram websocket stream (see useAudioBackupRecorder.ts)."""
    client = get_minio()
    file_id = str(uuid.uuid4())
    safe_name = filename.replace(" ", "_")
    object_name = f"note_sessions/{session_id}/{file_id}_{safe_name}"

    client.put_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        data=BytesIO(content),
        length=len(content),
        content_type=mime_type,
    )
    return object_name


async def minio_upload_agreement(
    content: bytes,
    agreement_id: uuid.UUID,
    filename: str,
    mime_type: str,
) -> str:
    """Stores an agreement's attached PDF/DOCX. Not student-scoped — regламенты
    приходят одной штукой на всех менторов, не привязаны к documents.student_id."""
    client = get_minio()
    safe_name = filename.replace(" ", "_")
    object_name = f"agreements/{agreement_id}/{safe_name}"

    client.put_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=object_name,
        data=BytesIO(content),
        length=len(content),
        content_type=mime_type,
    )
    return object_name


async def minio_download(storage_path: str) -> bytes:
    client = get_minio()
    response = client.get_object(bucket_name=settings.MINIO_BUCKET_NAME, object_name=storage_path)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


async def minio_copy_to_student(storage_path: str, student_id: uuid.UUID, filename: str) -> str:
    client = get_minio()
    file_id = str(uuid.uuid4())
    safe_name = filename.replace(" ", "_")
    dest_path = f"students/{student_id}/{file_id}_{safe_name}"

    from minio.commonconfig import CopySource

    client.copy_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=dest_path,
        source=CopySource(settings.MINIO_BUCKET_NAME, storage_path),
    )
    return dest_path


async def minio_url(storage_path: str, expires_seconds: int = 3600) -> str:
    from datetime import timedelta
    client = get_minio()
    url = client.presigned_get_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=storage_path,
        expires=timedelta(seconds=expires_seconds),
    )
    parsed = urlparse(url)
    if settings.ENVIRONMENT == "development" and parsed.hostname == "minio":
        netloc = "localhost"
        if parsed.port:
            netloc = f"{netloc}:{parsed.port}"
        url = urlunparse(parsed._replace(netloc=netloc))
    return url


async def minio_delete(storage_path: str) -> None:
    client = get_minio()
    client.remove_object(
        bucket_name=settings.MINIO_BUCKET_NAME,
        object_name=storage_path,
    )


def close_minio_object(obj) -> None:
    """For use as a StreamingResponse `background=BackgroundTask(...)` — the
    proxy-download pattern (stream the file through our backend rather than
    handing the browser a presigned URL) is what documents/telegram
    attachments use, since `minio_url()`'s dev hostname rewrite
    (minio -> localhost) invalidates the SigV4 signature (the Host is part
    of what's signed) and breaks presigned URLs for direct browser use."""
    try:
        obj.close()
    finally:
        obj.release_conn()
