"""Конспект из загруженной ментором записи: звонок в Telegram или WhatsApp,
по телефону, встреча вживую — всё, куда бот зайти не может.

Файл → MinIO → воркер распознаёт его в Deepgram с разделением на говорящих →
та же проверка качества и черновик конспекта, что после бота
(meeting_bot.service.complete_session_from_text)."""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from pathlib import PurePosixPath

from sqlalchemy import delete

from app.models.note_session import NoteSession, NoteSessionStatus
from app.models.note_transcript import NoteTranscript
from app.services.meeting_bot.quality import Utterance

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 300 * 1024 * 1024  # ~3 часа m4a/mp3 или короткое видео
ALLOWED_EXTENSIONS = {
    "mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "webm", "flac", "amr", "3gp",
    "mp4", "mov", "m4v",
}
ALLOWED_MIME_PREFIXES = ("audio/", "video/")


def is_allowed_audio(filename: str | None, content_type: str | None) -> bool:
    """Аудио или видео со звуком. Чистая функция — покрыта тестами."""
    ext = PurePosixPath((filename or "").lower()).suffix.lstrip(".")
    if ext in ALLOWED_EXTENSIONS:
        return True
    return bool(content_type) and content_type.lower().startswith(ALLOWED_MIME_PREFIXES)


def guess_mime(filename: str | None, content_type: str | None) -> str:
    if content_type and content_type.lower().startswith(ALLOWED_MIME_PREFIXES):
        return content_type
    ext = PurePosixPath((filename or "").lower()).suffix.lstrip(".")
    return {
        "mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "wav": "audio/wav",
        "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg", "webm": "audio/webm",
        "flac": "audio/flac", "amr": "audio/amr", "3gp": "audio/3gpp",
        "mp4": "video/mp4", "mov": "video/quicktime", "m4v": "video/mp4",
    }.get(ext, "application/octet-stream")


async def process_uploaded_audio(session_id: uuid.UUID, mime_type: str) -> str:
    from app.core.database import AsyncSessionLocal
    from app.services.deepgram_rest import transcribe_audio_utterances
    from app.services.meeting_bot.service import _notify_failed, _push_status, complete_session_from_text
    from app.services.minio_service import minio_download

    async with AsyncSessionLocal() as db:
        session = await db.get(NoteSession, session_id)
        if not session or session.note_id or not session.audio_storage_path:
            return "skipped"
        try:
            content = await minio_download(session.audio_storage_path)
            rows = await transcribe_audio_utterances(content, mime_type, session.language)
        except Exception:
            logger.exception("Uploaded audio transcription failed for session %s", session_id)
            session.bot_status = "failed"
            session.bot_status_reason = "transcription_failed"
            session.status = NoteSessionStatus.failed
            await db.commit()
            await _notify_failed(db, session)
            await _push_status(session)
            return "failed"

        utterances = [Utterance(**row) for row in rows]
        await db.execute(delete(NoteTranscript).where(NoteTranscript.session_id == session.id))
        base = session.started_at
        transcripts = []
        for index, utterance in enumerate(utterances):
            row = NoteTranscript(
                session_id=session.id,
                text=utterance.text,
                timestamp=base + timedelta(milliseconds=utterance.start_ms),
                speaker=utterance.speaker,
                client_segment_id=f"upload:{index}",
                sequence_no=index,
            )
            db.add(row)
            transcripts.append(row)
        await db.flush()

        duration = None
        if utterances:
            last = max(utterances, key=lambda u: u.start_ms + u.duration_ms)
            duration = (last.start_ms + last.duration_ms) / 1000
        return await complete_session_from_text(
            db,
            session,
            utterances=utterances,
            rows=transcripts,
            duration_seconds=duration,
            cut_short=False,
            empty_reason="no_text_file",
        )
