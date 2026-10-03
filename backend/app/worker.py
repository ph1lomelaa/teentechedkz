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
from arq import func
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
                chunk.transcript_text = await transcribe_audio_file(content, "audio/webm", session.language)
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


async def finalize_bot_session_task(ctx, session_id: str) -> None:
    """Встреча с ботом закончилась: текст, звук, проверка качества, черновик
    конспекта и уведомление ментору (services/meeting_bot/service.py)."""
    from app.services.meeting_bot.service import finalize_bot_session

    result = await finalize_bot_session(uuid.UUID(session_id))
    logger.info("finalize_bot_session_task %s -> %s", session_id, result)


async def simulate_mock_bot_task(ctx, session_id: str, bot_id: str) -> None:
    """Имитация бота (MEETING_BOT_PROVIDER=mock): проигрывает сценарий событий
    через тот же обработчик, что и настоящие вебхуки."""
    from app.services.meeting_bot.mock import MOCK_SCRIPT
    from app.services.meeting_bot.service import handle_provider_event

    elapsed = 0.0
    for index, (delay, event) in enumerate(MOCK_SCRIPT):
        await asyncio.sleep(max(0.0, delay - elapsed))
        elapsed = delay
        payload = {
            **event,
            "idempotency_key": f"mock:{bot_id}:{index}",
            "bot_id": bot_id,
            "bot_metadata": {"note_session_id": session_id},
        }
        async with AsyncSessionLocal() as db:
            session = await db.get(NoteSession, uuid.UUID(session_id))
            # Ментор остановил бота или отправил новый — имитацию прекращаем.
            if not session or session.bot_external_id != bot_id or session.bot_status in ("failed", "done"):
                return
            await handle_provider_event(db, "mock", payload)


async def transcribe_uploaded_audio_task(ctx, session_id: str, mime_type: str) -> None:
    """Загруженная ментором запись → реплики по говорящим → черновик конспекта."""
    from app.services.note_upload import process_uploaded_audio

    result = await process_uploaded_audio(uuid.UUID(session_id), mime_type)
    logger.info("transcribe_uploaded_audio_task %s -> %s", session_id, result)


async def retranscribe_session_task(ctx, session_id: str) -> None:
    """«Распознать заново»: звук встречи из MinIO → Deepgram (язык сессии) →
    резервный текст. Если конспекта ещё нет — собираем его."""
    from app.models.note_transcript import NoteTranscript
    from app.models.student import Student
    from app.services.meeting_bot.service import send_session_notification
    from app.models.student_note import StudentNote
    from app.services.note_session_finalize import (
        build_note_for_session,
        rebuild_note_draft,
        session_source_text,
    )

    async with AsyncSessionLocal() as db:
        session = await db.get(NoteSession, uuid.UUID(session_id))
        if not session or not session.audio_storage_path:
            return
        try:
            content = await minio_download(session.audio_storage_path)
            text = await transcribe_audio_file(content, "audio/mpeg", session.language)
        except Exception:
            logger.exception("Retranscription failed for session %s", session_id)
            await send_session_notification(
                db, session, kind="meeting_bot_failed",
                title="Не удалось распознать заново",
                body=f"Попробуйте позже или допишите конспект вручную. [session:{session.id}]",
            )
            return
        session.backup_transcript_text = text
        if not text.strip():
            await db.commit()
            await send_session_notification(
                db, session, kind="meeting_bot_failed",
                title="В записи не распознано ни слова",
                body=f"Проверьте выбранный язык встречи. [session:{session.id}]",
            )
            return
        rows = list((await db.scalars(
            select(NoteTranscript).where(NoteTranscript.session_id == session.id).order_by(NoteTranscript.sequence_no)
        )).all())
        student = await db.get(Student, session.student_id) if session.student_id else None
        if session.note_id:
            # «Запись неполная»: черновик уже есть, и кнопка стоит на его
            # странице. Пересобираем его по новому тексту, пока не утверждён.
            note = await db.get(StudentNote, session.note_id)
            # Только новый текст: он распознан по всему звуку встречи, а живой
            # транскрипт неполной записи дал бы в конспекте повтор разговора.
            rebuilt = note is not None and await rebuild_note_draft(
                db, session, note,
                source_text=text,
                student=student,
                actor_id=session.created_by,
            )
            await db.commit()
            await send_session_notification(
                db, session, kind="note_ready",
                title="Конспект пересобран — проверьте" if rebuilt else "Текст распознан заново",
                body=(f"Черновик собран заново по распознанному тексту. [session:{session.id}]" if rebuilt
                      else f"Конспект уже проверен, поэтому не изменён; новый текст сохранён в сессии. [session:{session.id}]"),
            )
            return
        await build_note_for_session(
            db, session,
            source_text=session_source_text(session, rows),
            student=student,
            student_name=student.full_name if student else None,
            actor_id=session.created_by,
        )
        session.bot_status = "done" if session.capture_mode == "bot" else session.bot_status
        await db.commit()
        await send_session_notification(
            db, session, kind="note_ready",
            title="Конспект готов — проверьте",
            body=f"Текст распознан заново, черновик конспекта ждёт проверки. [session:{session.id}]",
        )


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

    if settings.ENABLE_MEETING_TELEGRAM_NOTIFICATIONS and settings.TELEGRAM_BOT_TOKEN:
        from app.services.meeting_telegram import meeting_telegram_loop
        tasks.append(asyncio.create_task(meeting_telegram_loop()))

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

    if settings.ENABLE_TASK_SLA:
        from app.services.task_sla_notifier import task_sla_loop
        tasks.append(asyncio.create_task(task_sla_loop()))
        logger.info("Task SLA loop started")
    else:
        logger.info("Task SLA enforcement disabled")

    if settings.ENABLE_NOTE_SESSION_CLEANUP:
        from app.services.note_session_cleanup import note_session_cleanup_loop
        tasks.append(asyncio.create_task(note_session_cleanup_loop()))
        logger.info("Note session cleanup loop started")
    else:
        logger.info("Note session cleanup disabled")

    if settings.MEETING_BOT_ENABLED:
        from app.services.meeting_bot.service import meeting_bot_watchdog_loop
        tasks.append(asyncio.create_task(meeting_bot_watchdog_loop()))
        logger.info("Meeting bot watchdog started")
    else:
        logger.info("Meeting bot disabled")

    if settings.ENABLE_DAILY_CHECKIN:
        from app.services.checkin_notifier import checkin_loop
        tasks.append(asyncio.create_task(checkin_loop()))
        logger.info("Checkin loop started")
    else:
        logger.info("Daily check-ins disabled")

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
        finalize_bot_session_task,
        simulate_mock_bot_task,
        retranscribe_session_task,
        # Час записи Deepgram распознаёт минуты — общий job_timeout (300 с) мал.
        func(transcribe_uploaded_audio_task, timeout=1800),
        process_telegram_attachment_task,
        extract_telegram_insight_task,
    ]
    on_startup = on_startup
    on_shutdown = on_shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 15
    job_timeout = 300
