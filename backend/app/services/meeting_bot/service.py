"""Жизненный цикл записи ботом: запуск, события провайдера, сборка конспекта,
сторож. Развёртывание провайдера — attendee/README.md.

Статусы бота у сессии (note_sessions.bot_status):
  joining → waiting_room → recording (paused) → processing → done
  и failed с причиной (bot_status_reason, тексты — reasons.py).
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.meeting import Meeting, MeetingStatus
from app.models.meeting_bot_event import MeetingBotEvent
from app.models.note_session import NoteSession, NoteSessionStatus
from app.models.note_transcript import NoteTranscript
from app.models.student import Student
from app.models.user import User
from app.services.meeting_bot import get_provider
from app.services.meeting_bot.base import CreateBotRequest, MeetingBotError
from app.services.meeting_bot.platforms import ZOOM, detect_platform, normalize_meeting_url
from app.services.meeting_bot.quality import (
    QUALITY_EMPTY,
    QUALITY_INCOMPLETE,
    QUALITY_REASON_MESSAGES,
    Utterance,
    evaluate_quality,
)
from app.services.meeting_bot.reasons import reason_message
from app.services.notify import notify, push_notification, push_ws, was_sent

logger = logging.getLogger(__name__)

# Бот ещё в работе — сессию показываем в плашке «идёт запись».
ACTIVE_BOT_STATUSES = {"joining", "waiting_room", "waiting_permission", "recording", "paused", "processing"}
# Бот уже был во встрече и выпал — текст до обрыва собираем в конспект с пометкой.
CUT_SHORT_REASONS = {
    "process_terminated",
    "heartbeat_timeout",
    "ui_element_not_found",
    "attendee_internal_error",
    "global_runtime_timeout",
    "watchdog_no_events",
}

WAITING_ROOM_REMIND_AFTER = timedelta(minutes=3)
PROCESSING_STUCK_AFTER = timedelta(minutes=15)
POLL_PROVIDER_AFTER = timedelta(minutes=2)
# Провайдер не отвечает и событий нет: сначала предупреждаем ментора, потом
# закрываем сессию с watchdog_no_events (текст до обрыва уходит в конспект).
NO_EVENTS_WARN_AFTER = timedelta(minutes=2)
NO_EVENTS_FAIL_AFTER = timedelta(minutes=10)
MEETING_REMIND_AFTER_START = timedelta(minutes=3)
MEETING_REMIND_WINDOW = timedelta(minutes=30)


class BotStartError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def webhook_url(provider_name: str) -> str:
    base = (settings.PUBLIC_API_BASE_URL or settings.FRONTEND_URL).rstrip("/")
    return f"{base}/api/v1/webhooks/meeting-bot/{provider_name}"


def session_link(session: NoteSession) -> str:
    if session.note_id:
        return f"/workspace/meetings/notes/{session.note_id}"
    return f"/workspace/meetings/session/{session.id}"


# ---------------------------------------------------------------- состояния


@dataclass(frozen=True)
class StateChange:
    bot_status: str
    reason: str | None = None
    finalize: bool = False


def map_provider_state(
    new_state: str,
    *,
    event_type: str | None = None,
    event_sub_type: str | None = None,
    had_joined: bool,
) -> StateChange | None:
    """Состояние Attendee → наш bot_status. Чистая функция — покрыта тестами."""
    if new_state in ("scheduled", "staged", "ready", "joining", "joined_not_recording",
                     "joining_breakout_room", "leaving_breakout_room"):
        return StateChange("joining")
    if new_state == "waiting_room":
        return StateChange("waiting_room")
    if new_state == "joined_recording_permission_denied":
        return StateChange("waiting_permission", reason=event_sub_type or "host_denied_permission")
    if new_state == "joined_recording":
        return StateChange("recording")
    if new_state == "joined_recording_paused":
        return StateChange("paused")
    if new_state in ("leaving", "post_processing"):
        if event_type == "could_not_join_meeting" or not had_joined:
            return StateChange("failed", reason=event_sub_type or "unable_to_connect_to_meeting")
        return StateChange("processing")
    if new_state == "ended":
        if event_type == "could_not_join_meeting" or not had_joined:
            return StateChange("failed", reason=event_sub_type or "meeting_ended_before_bot_joined")
        return StateChange("processing", finalize=True)
    if new_state == "fatal_error":
        if had_joined:
            return StateChange("processing", reason=event_sub_type or "process_terminated", finalize=True)
        return StateChange("failed", reason=event_sub_type or "attendee_internal_error")
    return None


# ---------------------------------------------------------------- запуск


async def start_bot(
    db: AsyncSession,
    session: NoteSession,
    *,
    user: User,
    meeting_url: str,
    language: str | None = None,
) -> NoteSession:
    if not settings.MEETING_BOT_ENABLED:
        raise BotStartError("MEETING_BOT_DISABLED", "Запись ботом пока выключена.", status=503)
    if session.note_id or session.status in (NoteSessionStatus.completed, NoteSessionStatus.cancelled):
        raise BotStartError("NOTE_SESSION_FINISHED", "Сессия уже завершена.")
    if session.bot_status in ACTIVE_BOT_STATUSES and session.bot_status != "processing":
        raise BotStartError("BOT_ALREADY_RUNNING", "Бот уже отправлен на эту встречу.")

    platform = detect_platform(meeting_url)
    if not platform:
        raise BotStartError(
            "MEETING_URL_UNSUPPORTED",
            "Бот умеет заходить только в Zoom, Google Meet и Microsoft Teams. "
            "Вставьте ссылку на встречу Zoom, Google Meet или Microsoft Teams.",
            status=422,
        )
    if platform == ZOOM and not (user.zoom_user_id and user.zoom_connection_state != "disconnected"):
        raise BotStartError("ZOOM_NOT_CONNECTED", reason_message("zoom_not_connected") or "", status=409)

    if language:
        session.language = language
    url = normalize_meeting_url(meeting_url)
    provider = get_provider()
    try:
        bot = await provider.create_bot(
            CreateBotRequest(
                meeting_url=url,
                platform=platform,
                bot_name=settings.MEETING_BOT_NAME,
                language=session.language or "ru",
                chat_message=settings.MEETING_BOT_CHAT_MESSAGE,
                metadata={"note_session_id": str(session.id)},
                webhook_url=webhook_url(provider.name),
                # Повторная отправка после сбоя — новый бот, а не дубль живого.
                deduplication_key=f"{session.id}:{int(_now().timestamp())}",
                zoom_user_id=user.zoom_user_id if platform == ZOOM else None,
            )
        )
    except MeetingBotError as exc:
        raise BotStartError("BOT_PROVIDER_UNAVAILABLE", reason_message(exc.code) or str(exc), status=503) from exc

    now = _now()
    session.capture_mode = "bot"
    session.meeting_url = url
    session.bot_provider = provider.name
    session.bot_external_id = bot.external_id
    session.bot_status = "joining"
    session.bot_status_reason = None
    session.bot_last_event_at = now
    session.bot_joined_at = None
    if session.status == NoteSessionStatus.draft:
        session.started_at = now
    session.status = NoteSessionStatus.active
    session.last_heartbeat_at = now
    return session


async def leave_bot(session: NoteSession) -> None:
    if not session.bot_external_id or not session.bot_provider:
        return
    try:
        await get_provider(session.bot_provider).leave_bot(session.bot_external_id)
    except MeetingBotError:
        logger.warning("Leave request for bot %s failed", session.bot_external_id, exc_info=True)


# ---------------------------------------------------------------- события


def _utterance_timestamp(session: NoteSession, start_ms: int) -> datetime:
    # Attendee отдаёт время фрагмента в миллисекундах эпохи; на случай
    # относительного времени отсчитываем от входа бота.
    if start_ms > 10**12:
        return datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
    base = session.bot_joined_at or session.started_at or _now()
    return base + timedelta(milliseconds=start_ms)


async def _append_transcript(db: AsyncSession, session: NoteSession, utterance: Utterance, segment_id: str) -> bool:
    existing = await db.scalar(
        select(NoteTranscript.id).where(
            NoteTranscript.session_id == session.id,
            NoteTranscript.client_segment_id == segment_id,
        )
    )
    if existing:
        return False
    current_max = await db.scalar(
        select(func.max(NoteTranscript.sequence_no)).where(NoteTranscript.session_id == session.id)
    )
    db.add(
        NoteTranscript(
            session_id=session.id,
            text=utterance.text,
            timestamp=_utterance_timestamp(session, utterance.start_ms),
            speaker=utterance.speaker,
            client_segment_id=segment_id,
            sequence_no=(current_max if current_max is not None else -1) + 1,
        )
    )
    return True


def _apply_state(session: NoteSession, change: StateChange, now: datetime) -> bool:
    previous = (session.bot_status, session.bot_status_reason)
    if change.bot_status == "recording" and session.bot_joined_at is None:
        session.bot_joined_at = now
    session.bot_status = change.bot_status
    if change.reason or change.bot_status not in ("processing",):
        session.bot_status_reason = change.reason
    if change.bot_status == "failed":
        session.status = NoteSessionStatus.failed if not session.note_id else session.status
        session.ended_at = session.ended_at or now
    if change.bot_status == "processing":
        session.ended_at = session.ended_at or now
    return previous != (session.bot_status, session.bot_status_reason)


async def _find_session(db: AsyncSession, payload: dict) -> NoteSession | None:
    metadata = payload.get("bot_metadata") or {}
    session_id = metadata.get("note_session_id") if isinstance(metadata, dict) else None
    if session_id:
        try:
            session = await db.get(NoteSession, uuid.UUID(str(session_id)))
        except ValueError:
            session = None
        if session:
            return session
    bot_id = payload.get("bot_id")
    if bot_id:
        return await db.scalar(select(NoteSession).where(NoteSession.bot_external_id == str(bot_id)))
    return None


@dataclass
class EventOutcome:
    session_id: uuid.UUID | None = None
    duplicate: bool = False
    finalize: bool = False
    failed: bool = False
    status_changed: bool = False


async def handle_provider_event(db: AsyncSession, provider_name: str, payload: dict) -> EventOutcome:
    """Один вебхук провайдера (или событие имитации). Идемпотентно по idempotency_key."""
    trigger = str(payload.get("trigger") or "")
    data = payload.get("data") or {}
    key = str(payload.get("idempotency_key") or uuid.uuid4())

    if trigger == "zoom_oauth_connection.state_change":
        await _record_event(db, key, None, provider_name, trigger, payload)
        connection_id = payload.get("zoom_oauth_connection_id")
        if connection_id:
            user = await db.scalar(select(User).where(User.zoom_connection_id == str(connection_id)))
            if user:
                user.zoom_connection_state = str(data.get("state") or "disconnected")
        await db.commit()
        return EventOutcome()

    session = await _find_session(db, payload)
    if not await _record_event(db, key, session.id if session else None, provider_name, trigger, payload):
        return EventOutcome(session_id=session.id if session else None, duplicate=True)
    if not session:
        await db.commit()
        logger.warning("Meeting bot event %s for unknown session (bot %s)", trigger, payload.get("bot_id"))
        return EventOutcome()

    now = _now()
    outcome = EventOutcome(session_id=session.id)
    session.bot_last_event_at = now

    if trigger == "bot.state_change":
        change = map_provider_state(
            str(data.get("new_state") or ""),
            event_type=data.get("event_type"),
            event_sub_type=data.get("event_sub_type"),
            had_joined=session.bot_joined_at is not None,
        )
        if change and session.bot_status not in ("done",):
            outcome.status_changed = _apply_state(session, change, now)
            outcome.finalize = change.finalize and not session.note_id
            outcome.failed = change.bot_status == "failed"
    elif trigger == "transcript.update":
        transcription = data.get("transcription") or {}
        text = (transcription.get("transcript") or "").strip()
        if text:
            if session.bot_joined_at is None:
                session.bot_joined_at = now
                if session.bot_status in ("joining", "waiting_room"):
                    session.bot_status = "recording"
                    outcome.status_changed = True
            start_ms = int(data.get("timestamp_ms") or 0)
            utterance = Utterance(
                speaker=data.get("speaker_name"),
                text=text,
                start_ms=start_ms,
                duration_ms=int(data.get("duration_ms") or 0),
                is_host=data.get("speaker_is_host"),
            )
            await _append_transcript(db, session, utterance, f"bot:{data.get('speaker_uuid')}:{start_ms}")
            session.last_heartbeat_at = now
    try:
        await db.commit()
    except IntegrityError:
        # Два фрагмента пришли одновременно и взяли один sequence_no. Отвечаем
        # 200, повтора не будет: живой фрагмент теряется только в плашке, а
        # конспект собирается из финального транскрипта провайдера.
        await db.rollback()
        logger.warning("Concurrent transcript insert for session %s: live fragment dropped, final transcript covers it", session.id)
        return outcome

    if outcome.failed:
        await _notify_failed(db, session)
    if outcome.status_changed:
        await _push_status(session)
    if outcome.finalize:
        from app.services.queue import get_arq_pool

        redis = await get_arq_pool()
        await redis.enqueue_job("finalize_bot_session_task", str(session.id))
    return outcome


async def _record_event(
    db: AsyncSession, key: str, session_id: uuid.UUID | None, provider: str, trigger: str, payload: dict
) -> bool:
    exists = await db.scalar(select(MeetingBotEvent.id).where(MeetingBotEvent.idempotency_key == key))
    if exists:
        return False
    db.add(MeetingBotEvent(idempotency_key=key, session_id=session_id, provider=provider, trigger=trigger, payload=payload))
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return False
    return True


async def _push_status(session: NoteSession) -> None:
    if not session.created_by:
        return
    try:
        await push_ws(
            [session.created_by],
            "note_session.bot_status",
            {
                "id": str(session.id),
                "bot_status": session.bot_status,
                "bot_status_reason": session.bot_status_reason,
                "bot_status_message": reason_message(session.bot_status_reason),
                "note_id": str(session.note_id) if session.note_id else None,
            },
        )
    except Exception:
        logger.debug("WS push for session %s failed", session.id, exc_info=True)


async def send_session_notification(db: AsyncSession, session: NoteSession, *, kind: str, title: str, body: str, priority: str = "normal") -> None:
    if not session.created_by:
        return
    note = notify(db, session.created_by, kind=kind, title=title, body=body, link=session_link(session), priority=priority)
    await db.commit()
    try:
        await push_notification(note)
    except Exception:
        logger.debug("Notification push for session %s failed", session.id, exc_info=True)


async def _student_name(db: AsyncSession, session: NoteSession) -> str | None:
    if not session.student_id:
        return None
    return await db.scalar(select(Student.full_name).where(Student.id == session.student_id))


async def _notify_failed(db: AsyncSession, session: NoteSession) -> None:
    name = await _student_name(db, session)
    await send_session_notification(
        db,
        session,
        kind="meeting_bot_failed",
        title="Запись не идёт" + (f" · {name}" if name else ""),
        body=f"{reason_message(session.bot_status_reason) or ''} [session:{session.id}]",
        priority="high",
    )


# ---------------------------------------------------------------- после встречи


def _db_utterances(rows: list[NoteTranscript]) -> list[Utterance]:
    if not rows:
        return []
    first = rows[0].timestamp
    return [
        Utterance(
            speaker=row.speaker,
            text=row.text,
            start_ms=int((row.timestamp - first).total_seconds() * 1000),
        )
        for row in rows
    ]


async def finalize_bot_session(session_id: uuid.UUID) -> str:
    """Встреча закончилась: финальный текст, звук в MinIO, проверка качества,
    черновик конспекта, уведомление. Вызывается из воркера."""
    from app.core.database import AsyncSessionLocal
    from app.services.minio_service import minio_upload_note_audio

    async with AsyncSessionLocal() as db:
        session = await db.get(NoteSession, session_id)
        if not session or session.note_id:
            return "skipped"
        session.bot_status = "processing"
        await db.commit()
        provider = get_provider(session.bot_provider) if session.bot_provider else None

        # 1. Финальный транскрипт провайдера (с уверенностью распознавания)
        #    заменяет фрагменты, пришедшие по ходу встречи.
        utterances: list[Utterance] = []
        if provider and session.bot_external_id:
            try:
                utterances = await provider.get_transcript(session.bot_external_id)
            except MeetingBotError:
                logger.warning("Final transcript fetch failed for session %s", session.id, exc_info=True)
        if utterances:
            ordered = sorted(utterances, key=lambda u: u.start_ms)
            await db.execute(delete(NoteTranscript).where(NoteTranscript.session_id == session.id))
            for index, utterance in enumerate(ordered):
                db.add(
                    NoteTranscript(
                        session_id=session.id,
                        text=utterance.text,
                        timestamp=_utterance_timestamp(session, utterance.start_ms),
                        speaker=utterance.speaker,
                        client_segment_id=f"bot-final:{index}",
                        sequence_no=index,
                    )
                )
            await db.flush()

        rows = list(
            (await db.scalars(
                select(NoteTranscript)
                .where(NoteTranscript.session_id == session.id)
                .order_by(NoteTranscript.sequence_no)
            )).all()
        )
        if not utterances:
            utterances = _db_utterances(rows)

        # 2. Звук встречи — к себе, для «Распознать заново».
        if provider and session.bot_external_id and not session.audio_storage_path:
            try:
                recording = await provider.get_recording(session.bot_external_id)
                if recording:
                    content, mime = recording
                    session.audio_storage_path = await minio_upload_note_audio(
                        content=content, session_id=session.id, filename="meeting.mp3", mime_type=mime
                    )
            except Exception:
                logger.warning("Recording copy failed for session %s", session.id, exc_info=True)

        # 3–4. Проверка качества, черновик, уведомление.
        duration = None
        if session.bot_joined_at and session.ended_at:
            duration = (session.ended_at - session.bot_joined_at).total_seconds()
        return await complete_session_from_text(
            db,
            session,
            utterances=utterances,
            rows=rows,
            duration_seconds=duration,
            cut_short=session.bot_status_reason in CUT_SHORT_REASONS,
        )


async def complete_session_from_text(
    db: AsyncSession,
    session: NoteSession,
    *,
    utterances: list[Utterance],
    rows: list[NoteTranscript],
    duration_seconds: float | None,
    cut_short: bool,
    empty_reason: str = "no_text",
) -> str:
    """Общий конец записи ботом и загрузки файла: проверка качества → черновик
    конспекта → уведомление ментору. Пустой текст — failed, черновик не создаётся."""
    from app.services.note_session_finalize import build_note_for_session, session_source_text

    result = evaluate_quality(
        utterances,
        duration_seconds=duration_seconds,
        cut_short=cut_short,
        enforce=settings.NOTE_QUALITY_ENFORCE,
    )
    session.quality = result.quality
    session.quality_reasons = result.reasons
    session.quality_warnings = result.warnings
    session.quality_metrics = result.metrics

    if result.quality == QUALITY_EMPTY:
        session.bot_status = "failed"
        session.bot_status_reason = empty_reason
        session.status = NoteSessionStatus.failed
        await db.commit()
        await _notify_failed(db, session)
        await _push_status(session)
        return "empty"

    student = await db.get(Student, session.student_id) if session.student_id else None
    await build_note_for_session(
        db,
        session,
        source_text=session_source_text(session, rows),
        student=student,
        student_name=student.full_name if student else None,
        actor_id=session.created_by,
    )
    session.bot_status = "done"
    await db.commit()

    name = student.full_name if student else None
    if result.quality == QUALITY_INCOMPLETE:
        reasons = " ".join(QUALITY_REASON_MESSAGES.get(r, "") for r in result.reasons).strip()
        await send_session_notification(
            db,
            session,
            kind="note_ready",
            title="Запись неполная — проверьте конспект" + (f" · {name}" if name else ""),
            body=f"{reasons} [session:{session.id}]",
            priority="high",
        )
    else:
        await send_session_notification(
            db,
            session,
            kind="note_ready",
            title="Конспект готов — проверьте" + (f" · {name}" if name else ""),
            body=f"Встреча «{session.title}» записана, черновик ждёт вашей проверки. [session:{session.id}]",
        )
    await _push_status(session)
    return result.quality


# ---------------------------------------------------------------- сторож


async def run_watchdog(now: datetime | None = None) -> dict[str, int]:
    """Раз в минуту: сверяет зависшие боты с провайдером, напоминает
    «впустите бота» и «встреча идёт, запись не включена»."""
    from app.core.database import AsyncSessionLocal
    from app.services.queue import get_arq_pool

    now = now or _now()
    counts = {"polled": 0, "reminded": 0, "requeued": 0, "meeting_reminders": 0}

    async with AsyncSessionLocal() as db:
        sessions = list(
            (await db.scalars(
                select(NoteSession).where(
                    NoteSession.capture_mode == "bot",
                    NoteSession.bot_status.in_(ACTIVE_BOT_STATUSES),
                    NoteSession.note_id.is_(None),
                )
            )).all()
        )
        for session in sessions:
            last = session.bot_last_event_at or session.started_at or now
            idle = now - last

            # Потерянные вебхуки: спрашиваем провайдера напрямую.
            if (
                session.bot_status != "processing"
                and idle >= POLL_PROVIDER_AFTER
                and session.bot_provider not in (None, "mock")
                and session.bot_external_id
            ):
                counts["polled"] += 1
                alive = await _reconcile_with_provider(db, session)
                if not alive and session.bot_status in ACTIVE_BOT_STATUSES - {"processing"}:
                    counts["silent"] = counts.get("silent", 0) + 1
                    await _handle_silent_bot(db, session, idle, now)
                    if session.bot_status not in ACTIVE_BOT_STATUSES - {"processing"}:
                        continue

            if session.bot_status in ("joining", "waiting_room") and now - (session.started_at or now) >= WAITING_ROOM_REMIND_AFTER:
                marker = f"[admit:{session.id}]"
                # was_sent, а не has_unread: прочитанное напоминание не должно
                # возвращаться каждую минуту.
                if session.created_by and not await was_sent(
                    db, session.created_by, kind="meeting_bot_waiting", body_contains=marker
                ):
                    counts["reminded"] += 1
                    await send_session_notification(
                        db,
                        session,
                        kind="meeting_bot_waiting",
                        title="Впустите бота в звонок",
                        body=f"Бот «TeenTechEd» ждёт в зале ожидания. Впустите его, иначе встреча не запишется. {marker}",
                        priority="high",
                    )

            if session.bot_status == "processing" and idle >= PROCESSING_STUCK_AFTER:
                counts["requeued"] += 1
                session.bot_last_event_at = now
                await db.commit()
                redis = await get_arq_pool()
                await redis.enqueue_job("finalize_bot_session_task", str(session.id))

        counts["meeting_reminders"] = await _remind_unrecorded_meetings(db, now)
    return counts


async def _reconcile_with_provider(db: AsyncSession, session: NoteSession) -> bool:
    """Сверка с провайдером. False — провайдер не ответил (бот «молчит»)."""
    try:
        bot = await get_provider(session.bot_provider).get_bot(session.bot_external_id)
    except MeetingBotError:
        logger.warning("Watchdog: provider poll failed for session %s", session.id, exc_info=True)
        return False
    last_event = (bot.events or [])[-1] if bot.events else {}
    change = map_provider_state(
        bot.state,
        event_type=last_event.get("type"),
        event_sub_type=last_event.get("sub_type"),
        had_joined=session.bot_joined_at is not None,
    )
    if change:
        await _apply_change(db, session, change)
    return True


def silent_bot_change(*, idle: timedelta, had_joined: bool) -> StateChange | None:
    """Что делать с ботом, о котором ни вебхуков, ни ответа провайдера.
    Чистая функция — покрыта тестами."""
    if idle < NO_EVENTS_FAIL_AFTER:
        return None
    if had_joined:
        # Как fatal_error после входа: собираем то, что успели записать.
        return StateChange("processing", reason="watchdog_no_events", finalize=True)
    return StateChange("failed", reason="watchdog_no_events")


async def _handle_silent_bot(db: AsyncSession, session: NoteSession, idle: timedelta, now: datetime) -> None:
    change = silent_bot_change(idle=idle, had_joined=session.bot_joined_at is not None)
    if change:
        logger.warning("Watchdog: session %s silent for %s — closing", session.id, idle)
        await _apply_change(db, session, change)
        return
    marker = f"[silent:{session.id}]"
    if idle >= NO_EVENTS_WARN_AFTER and session.created_by and not await was_sent(
        db, session.created_by, kind="meeting_bot_silent", body_contains=marker
    ):
        await send_session_notification(
            db,
            session,
            kind="meeting_bot_silent",
            title="Бот не отвечает",
            body=f"Бот записи не выходит на связь {int(idle.total_seconds() // 60)} мин. "
                 f"Проверьте, что «TeenTechEd» есть в звонке. {marker}",
            priority="high",
        )


async def _apply_change(db: AsyncSession, session: NoteSession, change: StateChange) -> None:
    from app.services.queue import get_arq_pool

    changed = _apply_state(session, change, _now())
    session.bot_last_event_at = _now()
    await db.commit()
    if change.bot_status == "failed" and changed:
        await _notify_failed(db, session)
    if change.finalize:
        redis = await get_arq_pool()
        await redis.enqueue_job("finalize_bot_session_task", str(session.id))
    if changed:
        await _push_status(session)


async def _remind_unrecorded_meetings(db: AsyncSession, now: datetime) -> int:
    meetings = list(
        (await db.scalars(
            select(Meeting).where(
                Meeting.status == MeetingStatus.scheduled,
                Meeting.mentor_id.is_not(None),
                Meeting.meeting_link != "",
                Meeting.starts_at <= now - MEETING_REMIND_AFTER_START,
                Meeting.starts_at >= now - MEETING_REMIND_WINDOW,
            )
        )).all()
    )
    sent = 0
    for meeting in meetings:
        if not detect_platform(meeting.meeting_link):
            continue
        recording = await db.scalar(
            select(NoteSession.id).where(
                NoteSession.meeting_id == meeting.id,
                NoteSession.status != NoteSessionStatus.draft,
            )
        )
        if recording:
            continue
        marker = f"[meeting:{meeting.id}]"
        if await was_sent(db, meeting.mentor_id, kind="meeting_not_recording", body_contains=marker):
            continue
        note = notify(
            db,
            meeting.mentor_id,
            kind="meeting_not_recording",
            title="Встреча идёт, запись не включена",
            body=f"«{meeting.title}» началась {int((now - meeting.starts_at).total_seconds() // 60)} мин назад. Отправьте бота, чтобы получить конспект. {marker}",
            link=f"/workspace/meetings?record={meeting.id}",
            priority="high",
        )
        await db.commit()
        try:
            await push_notification(note)
        except Exception:
            logger.debug("Meeting reminder push failed", exc_info=True)
        sent += 1
    return sent


async def meeting_bot_watchdog_loop() -> None:
    import asyncio

    interval = settings.MEETING_BOT_WATCHDOG_INTERVAL_SECONDS
    logger.info(f"Meeting bot watchdog starting (interval: {interval}s)")
    while True:
        try:
            await run_watchdog()
        except Exception as e:
            logger.error(f"Meeting bot watchdog failed: {e}", exc_info=True)
        await asyncio.sleep(interval)
