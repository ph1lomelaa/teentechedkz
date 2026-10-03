"""Фоновая очистка сессий конспектов.

Сессия создаётся раньше, чем пошёл звук, поэтому неудачные попытки (закрыли
вкладку, не дали доступ к звуку, браузер не подошёл) раньше навсегда оставались
в списке как «конспект без текста». Здесь два правила:

- пустая сессия (нет текста, аудио, резервного текста и конспекта), к которой
  не было сигнала дольше EMPTY_TTL, удаляется;
- активная запись в браузере с данными, от которой дольше STALE_AFTER не было
  heartbeat, становится interrupted: ментор увидит «Запись прервана» и сможет
  собрать конспект из того, что успело сохраниться.

Сохранённый звук (mp3 бота, загруженный файл) — тоже данные: такую сессию
не удаляем, по ней можно распознать текст заново. Бот и загрузка heartbeat не
шлют — их зависания ловит сторож бота и воркер, а не этот таймер.
"""
from __future__ import annotations

import asyncio
import enum
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.note_session import NoteSession, NoteSessionStatus
from app.models.note_session_audio_chunk import NoteSessionAudioChunk
from app.models.note_transcript import NoteTranscript

logger = logging.getLogger(__name__)

EMPTY_TTL = timedelta(hours=24)
STALE_AFTER = timedelta(minutes=10)

# Пустые сессии в этих статусах можно удалять. completed без конспекта и без
# текста — наследие старого потока (end вызывался до finalize).
_DELETABLE_WHEN_EMPTY = {
    NoteSessionStatus.draft,
    NoteSessionStatus.active,
    NoteSessionStatus.interrupted,
    NoteSessionStatus.failed,
    NoteSessionStatus.completed,
}


class CleanupAction(str, enum.Enum):
    keep = "keep"
    delete = "delete"
    mark_interrupted = "mark_interrupted"


@dataclass(frozen=True)
class SessionSnapshot:
    status: NoteSessionStatus
    has_note: bool
    has_data: bool  # текст, аудио-чанки, сохранённый звук или резервный текст
    last_signal_at: datetime  # последний heartbeat, иначе started_at
    capture_mode: str = "browser"


def decide_cleanup(snapshot: SessionSnapshot, now: datetime) -> CleanupAction:
    """Что сделать с сессией. Чистая функция — покрыта тестами."""
    if snapshot.has_note or snapshot.status == NoteSessionStatus.cancelled:
        return CleanupAction.keep

    idle = now - snapshot.last_signal_at

    if not snapshot.has_data:
        if snapshot.status in _DELETABLE_WHEN_EMPTY and idle >= EMPTY_TTL:
            return CleanupAction.delete
        return CleanupAction.keep

    if (
        snapshot.capture_mode == "browser"
        and snapshot.status == NoteSessionStatus.active
        and idle >= STALE_AFTER
    ):
        return CleanupAction.mark_interrupted
    return CleanupAction.keep


async def cleanup_note_sessions(now: datetime | None = None) -> dict[str, int]:
    now = now or datetime.now(timezone.utc)
    has_transcripts = exists().where(NoteTranscript.session_id == NoteSession.id)
    has_chunks = exists().where(NoteSessionAudioChunk.session_id == NoteSession.id)
    counts = {"deleted": 0, "interrupted": 0}

    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(NoteSession, has_transcripts, has_chunks).where(
                NoteSession.note_id.is_(None),
                NoteSession.status != NoteSessionStatus.cancelled,
            )
        )
        for session, with_transcripts, with_chunks in rows.all():
            snapshot = SessionSnapshot(
                status=session.status,
                has_note=session.note_id is not None,
                has_data=bool(
                    with_transcripts
                    or with_chunks
                    or (session.backup_transcript_text or "").strip()
                    or session.audio_storage_path
                ),
                last_signal_at=session.last_heartbeat_at or session.started_at,
                capture_mode=session.capture_mode or "browser",
            )
            action = decide_cleanup(snapshot, now)
            if action == CleanupAction.delete:
                await db.delete(session)
                counts["deleted"] += 1
            elif action == CleanupAction.mark_interrupted:
                session.status = NoteSessionStatus.interrupted
                session.ended_at = session.ended_at or snapshot.last_signal_at
                counts["interrupted"] += 1
        await db.commit()

    if counts["deleted"] or counts["interrupted"]:
        logger.info(
            "Note session cleanup: deleted %s empty, marked %s interrupted",
            counts["deleted"],
            counts["interrupted"],
        )
    return counts


async def note_session_cleanup_loop() -> None:
    interval_seconds = settings.NOTE_SESSION_CLEANUP_INTERVAL_SECONDS
    logger.info(f"Note session cleanup loop starting (interval: {interval_seconds}s)")

    while True:
        try:
            await cleanup_note_sessions()
        except Exception as e:
            logger.error(f"Note session cleanup failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)
