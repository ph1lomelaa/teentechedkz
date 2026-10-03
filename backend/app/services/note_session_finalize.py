"""Сборка черновика конспекта из сессии записи.

Общая для кнопки «Завершить» (endpoints/note_sessions.finalize_session) и для
воркера после встречи с ботом (meeting_bot/service.finalize_bot_session).
Конспект создаётся черновиком (status=draft) — к профилю студента он
применяется только после проверки ментором.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ai_analysis_run import AiAnalysisRun
from app.models.note_session import NoteSession, NoteSessionStatus
from app.models.note_transcript import NoteTranscript
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.services.note_sessions import generate_note_draft
from app.services.student_notes import snapshot_student


def pop_ai_meta(draft: dict) -> dict:
    return draft.pop("__ai_meta", {}) if isinstance(draft, dict) else {}


def session_source_text(session: NoteSession, transcripts: list[NoteTranscript]) -> str:
    parts = [
        f"[{row.speaker}]: {row.text}" if row.speaker else row.text
        for row in transcripts
        if row.text and row.text.strip()
    ]
    if session.backup_transcript_text and session.backup_transcript_text.strip():
        parts.append(f"[Восстановленная аудиозапись]: {session.backup_transcript_text.strip()}")
    return "\n".join(parts).strip()


def add_note_ai_run(
    db: AsyncSession,
    *,
    session: NoteSession,
    student_id: uuid.UUID | None,
    source_text: str,
    snapshot: dict,
    draft: dict,
    ai_meta: dict,
    actor_id: uuid.UUID | None,
    status: str,
) -> None:
    db.add(
        AiAnalysisRun(
            source_type="note_session_draft",
            source_id=session.id,
            student_id=student_id,
            status=status,
            prompt_version=str(ai_meta.get("prompt_version") or "unknown"),
            model=ai_meta.get("model"),
            input_snapshot={
                "session_title": session.title,
                "source_text": source_text,
                "profile_snapshot": snapshot,
            },
            raw_output=ai_meta.get("raw_output"),
            parsed_output=ai_meta.get("parsed_output") or draft,
            filter_reasons=ai_meta.get("filter_reasons") or {},
            created_by=actor_id,
        )
    )


async def build_note_for_session(
    db: AsyncSession,
    session: NoteSession,
    *,
    source_text: str,
    student: Student | None,
    student_name: str | None,
    actor_id: uuid.UUID | None,
) -> StudentNote:
    """Создаёт черновик конспекта и закрывает сессию. Без commit."""
    snapshot = snapshot_student(student) if student else {}
    draft = await generate_note_draft(
        transcript=source_text,
        title=session.title,
        snapshot=snapshot,
        student_name=student.full_name if student else student_name,
    )
    ai_meta = pop_ai_meta(draft)

    note = StudentNote(
        student_id=session.student_id,
        title=draft["title"],
        source_text=source_text.strip(),
        summary_markdown=draft["summary_markdown"],
        student_summary_markdown=draft["student_summary_markdown"],
        profile_snapshot=snapshot,
        suggested_changes=draft["suggested_changes"],
        applied_changes={},
        status=StudentNoteStatus.draft,
        created_by=actor_id,
        reviewed_by=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(note)
    add_note_ai_run(
        db,
        session=session,
        student_id=session.student_id,
        source_text=source_text,
        snapshot=snapshot,
        draft=draft,
        ai_meta=ai_meta,
        actor_id=actor_id,
        status="note_created",
    )
    await db.flush()

    now = datetime.now(timezone.utc)
    session.note_id = note.id
    session.status = NoteSessionStatus.completed
    session.ended_at = session.ended_at or now
    session.last_heartbeat_at = now
    return note


async def rebuild_note_draft(
    db: AsyncSession,
    session: NoteSession,
    note: StudentNote,
    *,
    source_text: str,
    student: Student | None,
    actor_id: uuid.UUID | None,
) -> bool:
    """Пересобирает ещё не утверждённый черновик по новому тексту. Без commit.

    False — конспект уже утверждён или отклонён: его содержимое принадлежит
    человеку, который его проверял, перезаписывать нельзя.
    """
    if note.status != StudentNoteStatus.draft:
        return False
    snapshot = snapshot_student(student) if student else {}
    draft = await generate_note_draft(
        transcript=source_text,
        title=session.title,
        snapshot=snapshot,
        student_name=student.full_name if student else None,
    )
    ai_meta = pop_ai_meta(draft)
    note.title = draft["title"]
    note.source_text = source_text.strip()
    note.summary_markdown = draft["summary_markdown"]
    note.student_summary_markdown = draft["student_summary_markdown"]
    note.profile_snapshot = snapshot
    note.suggested_changes = draft["suggested_changes"]
    add_note_ai_run(
        db,
        session=session,
        student_id=session.student_id,
        source_text=source_text,
        snapshot=snapshot,
        draft=draft,
        ai_meta=ai_meta,
        actor_id=actor_id,
        status="note_rebuilt",
    )
    return True
