"""arq worker process — runs separately from the web tier (`uvicorn`) so that
slow, blocking calls to external APIs (Deepgram, MinIO) never hold up a web
request or the single shared DB connection pool. Started via:

    arq app.worker.WorkerSettings
"""
from __future__ import annotations

import asyncio
import logging
import uuid

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.config import settings
from app.models.note_session import NoteSession
from app.models.note_session_audio_chunk import NoteAudioChunkStatus, NoteSessionAudioChunk
from app.services.deepgram_rest import transcribe_audio_file
from app.services.minio_service import minio_download
from app.services.queue import get_arq_pool
from arq.connections import RedisSettings

# This process never imports app.main, so nothing else calls basicConfig —
# without it, INFO-level logs from this module and everything it calls
# (sheets/notion sync, payment notifier) are silently dropped by the root
# logger's default WARNING level, even though the loops are running fine.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def reconcile_audio_task(ctx, session_id: str) -> None:
    """Transcribes every not-yet-transcribed backup audio chunk for a session
    and stitches the results into `session.backup_transcript_text` — the same
    work `reconcile_audio` used to do inline inside the HTTP request."""
    async with AsyncSessionLocal() as db:
        session = await db.get(NoteSession, uuid.UUID(session_id))
        if not session:
            logger.warning("reconcile_audio_task: session %s not found", session_id)
            return

        result = await db.execute(
            select(NoteSessionAudioChunk)
            .where(NoteSessionAudioChunk.session_id == session.id)
            .order_by(NoteSessionAudioChunk.chunk_index)
        )
        chunks = list(result.scalars())

        for chunk in chunks:
            if chunk.status == NoteAudioChunkStatus.transcribed:
                continue
            try:
                content = await minio_download(chunk.storage_path)
                chunk.transcript_text = await transcribe_audio_file(content, "audio/webm")
                chunk.status = NoteAudioChunkStatus.transcribed
            except Exception:
                logger.exception(
                    "Failed to reconcile audio chunk %s for session %s", chunk.id, session_id
                )
                chunk.status = NoteAudioChunkStatus.failed

        session.backup_transcript_text = " ".join(
            c.transcript_text.strip() for c in chunks if c.transcript_text and c.transcript_text.strip()
        )
        await db.commit()


async def process_telegram_attachment_task(ctx, attachment_id: str) -> None:
    """Downloads a Telegram attachment, transcribes it if it's voice/video-note
    audio, and uploads it to MinIO — the slow, blocking part of
    telegram_ingest.ingest_message, now off the webhook's critical path.
    Chains into extract_telegram_insight_task afterwards so voice messages
    get AI-extracted against their *transcribed* text, not an empty string."""
    from app.models.document import Document, DocSource, DocType
    from app.models.telegram_attachment import TelegramAttachment, TelegramAttachmentStatus
    from app.models.telegram_chat import TelegramChat, TelegramChatStatus
    from app.models.telegram_chat_session import TelegramChatSession
    from app.models.telegram_message import TelegramMessage, TelegramMessageType
    from app.services.minio_service import minio_upload, minio_upload_raw
    from app.services.telegram_bot import get_bot

    row_id: uuid.UUID | None = None
    chat_paused = True

    async with AsyncSessionLocal() as db:
        attachment = await db.get(TelegramAttachment, uuid.UUID(attachment_id))
        if not attachment:
            logger.warning("process_telegram_attachment_task: attachment %s not found", attachment_id)
            return
        row = await db.get(TelegramMessage, attachment.message_id)
        if not row:
            logger.warning("process_telegram_attachment_task: message for attachment %s not found", attachment_id)
            return
        session = await db.get(TelegramChatSession, row.session_id) if row.session_id else None
        chat = await db.get(TelegramChat, row.chat_id)

        try:
            bot = get_bot()
            tg_file = await bot.get_file(attachment.telegram_file_id)
            buffer = await bot.download_file(tg_file.file_path)
            content = buffer.read()

            if row.message_type in (TelegramMessageType.voice, TelegramMessageType.video_note) and not row.raw_text:
                try:
                    transcript = await transcribe_audio_file(content, attachment.mime_type or "audio/ogg")
                    if transcript:
                        row.raw_text = transcript
                except Exception:
                    logger.exception("Failed to transcribe Telegram audio message %s", row.id)

            storage_path = await minio_upload_raw(
                content=content,
                chat_id=row.chat_id,
                filename=attachment.file_name or "file",
                mime_type=attachment.mime_type or "application/octet-stream",
            )
            attachment.storage_path = storage_path
            attachment.status = TelegramAttachmentStatus.downloaded

            if session and session.student_id and session.opened_by:
                try:
                    document_path = await minio_upload(
                        content=content,
                        student_id=session.student_id,
                        filename=attachment.file_name or "file",
                        mime_type=attachment.mime_type or "application/octet-stream",
                    )
                    db.add(Document(
                        student_id=session.student_id,
                        uploaded_by=session.opened_by,
                        doc_type=DocType.other,
                        file_name=attachment.file_name or "file",
                        file_size=attachment.file_size or len(content),
                        mime_type=attachment.mime_type or "application/octet-stream",
                        storage_path=document_path,
                        source=DocSource.telegram,
                        source_telegram_attachment_id=attachment.id,
                    ))
                except Exception:
                    logger.exception("Failed to register Telegram attachment %s as document", attachment.id)
        except Exception:
            logger.exception("Failed to download Telegram attachment %s", attachment.telegram_file_id)
            attachment.status = TelegramAttachmentStatus.failed

        await db.commit()
        row_id = row.id
        chat_paused = bool(chat and chat.status == TelegramChatStatus.paused)

    if row_id is not None and not chat_paused:
        pool = await get_arq_pool()
        await pool.enqueue_job("extract_telegram_insight_task", str(row_id))


async def extract_telegram_insight_task(ctx, message_id: str) -> None:
    """Runs AI insight extraction for one Telegram message — the other slow,
    blocking call (LLM completion) that used to run inline in the webhook."""
    from app.models.telegram_message import TelegramMessage
    from app.services.telegram_extraction import extract_insight_from_message

    async with AsyncSessionLocal() as db:
        row = await db.get(TelegramMessage, uuid.UUID(message_id))
        if not row:
            logger.warning("extract_telegram_insight_task: message %s not found", message_id)
            return
        await extract_insight_from_message(db, row)
        await db.commit()


async def _register_telegram_webhook() -> None:
    """Moved here from app.main's lifespan: with `uvicorn --workers N` that
    lifespan runs once per worker process, which would re-register the same
    webhook N times and start N duplicate health-check loops. This process
    is the one singleton, so it owns webhook registration + health checks."""
    from app.services.telegram_bot import get_bot

    bot = get_bot()
    webhook_url = settings.TELEGRAM_WEBHOOK_URL
    try:
        await bot.set_webhook(
            webhook_url,
            secret_token=settings.TELEGRAM_WEBHOOK_SECRET or None,
            allowed_updates=["message", "my_chat_member", "chat_member"],
        )
        logger.info(f"Telegram webhook set: {webhook_url}")
    except Exception as e:
        logger.error(f"Failed to set Telegram webhook: {e}")
        try:
            from app.models.user import User, UserRole
            from app.models.notification import Notification
            async with AsyncSessionLocal() as db:
                admin_result = await db.execute(
                    select(User).where(User.role.in_([UserRole.admin, UserRole.mzk_manager]))
                )
                for admin in admin_result.scalars():
                    db.add(Notification(
                        user_id=admin.id,
                        kind="telegram_webhook_failed",
                        title="Telegram webhook initialization failed",
                        body=f"Failed to register Telegram webhook at {webhook_url}: {str(e)[:200]}. Messages may not be received.",
                        priority="high",
                    ))
                await db.commit()
        except Exception:
            logger.exception("Failed to create admin notification for webhook failure")


async def on_startup(ctx: dict) -> None:
    """Runs once when the worker process boots — starts every singleton
    background loop that used to live in app.main's per-web-worker lifespan."""
    tasks: list[asyncio.Task] = []

    if settings.TELEGRAM_BOT_TOKEN and settings.TELEGRAM_WEBHOOK_URL:
        await _register_telegram_webhook()
        from app.services.telegram_bot import webhook_health_loop
        tasks.append(asyncio.create_task(webhook_health_loop()))
    else:
        logger.warning(
            "Telegram integration disabled: TELEGRAM_BOT_TOKEN=%s TELEGRAM_WEBHOOK_URL=%s (both required)",
            "set" if settings.TELEGRAM_BOT_TOKEN else "MISSING",
            "set" if settings.TELEGRAM_WEBHOOK_URL else "MISSING",
        )

    from app.services.sheets_sync import is_configured as sheets_configured, sync_loop as sheets_sync_loop
    if sheets_configured():
        tasks.append(asyncio.create_task(sheets_sync_loop()))
    else:
        logger.info("Sheets sync disabled: service account key is not configured")

    from app.services import notion_sync
    if notion_sync.is_configured():
        tasks.append(asyncio.create_task(notion_sync.sync_loop()))
    else:
        logger.info("Notion sync disabled: NOTION_API_KEY / NOTION_DATABASE_ID not configured")

    if settings.ENABLE_PAYMENT_NOTIFICATIONS:
        from app.services.payment_notifier import payment_notifier_loop
        tasks.append(asyncio.create_task(payment_notifier_loop()))
        logger.info("Payment notifier started")
    else:
        logger.info("Payment notifications disabled")

    if settings.ENABLE_TASK_URGENCY_NOTIFICATIONS:
        from app.services.task_urgency_notifier import task_urgency_notifier_loop
        tasks.append(asyncio.create_task(task_urgency_notifier_loop()))
        logger.info("Task urgency notifier started")
    else:
        logger.info("Task urgency notifications disabled")

    if settings.ENABLE_COMPLAINT_SLA_NOTIFICATIONS:
        from app.services.complaint_sla import complaint_sla_loop
        tasks.append(asyncio.create_task(complaint_sla_loop()))
        logger.info("Complaint SLA loop started")
    else:
        logger.info("Complaint SLA notifications disabled")

    if settings.ENABLE_MZK_QUALITY_SCORE:
        from app.services.mzk_quality_score import mzk_quality_score_loop
        tasks.append(asyncio.create_task(mzk_quality_score_loop()))
        logger.info("MZK quality score loop started")
    else:
        logger.info("MZK quality score computation disabled")

    ctx["background_tasks"] = tasks


async def on_shutdown(ctx: dict) -> None:
    for task in ctx.get("background_tasks", []):
        task.cancel()
    if settings.TELEGRAM_BOT_TOKEN:
        try:
            from app.services.telegram_bot import get_bot
            await get_bot().session.close()
        except Exception:
            pass


class WorkerSettings:
    functions = [
        reconcile_audio_task,
        process_telegram_attachment_task,
        extract_telegram_insight_task,
    ]
    on_startup = on_startup
    on_shutdown = on_shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 15
    job_timeout = 300
