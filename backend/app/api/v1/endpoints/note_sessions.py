from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.ai_analysis_run import AiAnalysisRun
from app.models.meeting import Meeting
from app.models.note_session import NoteSession, NoteSessionStatus
from app.models.note_session_audio_chunk import NoteAudioChunkStatus, NoteSessionAudioChunk
from app.models.note_transcript import NoteTranscript
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.user import UserRole
from app.schemas.note_session import (
    NoteSessionAudioChunkResponse,
    NoteSessionCreate,
    NoteSessionDetail,
    NoteSessionDraftResponse,
    NoteSessionFinalizeResponse,
    NoteSessionReconcileResponse,
    NoteSessionResponse,
    NoteTranscriptCreate,
    NoteTranscriptResponse,
)
from app.schemas.student_note import StudentNoteResponse
from app.services.deepgram_rest import transcribe_audio_file
from app.services.minio_service import minio_delete, minio_download, minio_upload_note_audio, minio_url
from app.services.note_sessions import generate_note_draft
from app.services.student_notes import render_change_preview, snapshot_student

MAX_AUDIO_CHUNK_SIZE = 60 * 1024 * 1024  # 60 MB — generous headroom for a ~5 min opus segment


router = APIRouter(prefix="/note-sessions", tags=["note-sessions"])


def _ai_meta(draft: dict) -> dict:
    return draft.pop("__ai_meta", {}) if isinstance(draft, dict) else {}


def _session_source_text(session: NoteSession, transcripts: list[NoteTranscript]) -> str:
    parts = [
        f"[{row.speaker}]: {row.text}" if row.speaker else row.text
        for row in transcripts
        if row.text and row.text.strip()
    ]
    if session.backup_transcript_text and session.backup_transcript_text.strip():
        parts.append(f"[Восстановленная аудиозапись]: {session.backup_transcript_text.strip()}")
    return "\n".join(parts).strip()


def _add_note_ai_run(
    db: AsyncSession,
    *,
    session: NoteSession,
    student_id: uuid.UUID | None,
    source_text: str,
    snapshot: dict,
    draft: dict,
    ai_meta: dict,
    current_user,
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
            created_by=current_user.id,
        )
    )


def _is_staff_admin(current_user) -> bool:
    return current_user.role in (UserRole.admin, UserRole.mzk_manager)


async def _mentor_student_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    from app.models.mentor_assignment import MentorAssignment

    result = await db.execute(
        select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == user_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
    )
    return {row[0] for row in result.all()}


async def _load_accessible_student(db: AsyncSession, current_user, student_id: uuid.UUID) -> Student:
    result = await db.execute(select(Student).where(Student.id == student_id, Student.is_archived == False))  # noqa: E712
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    if _is_staff_admin(current_user):
        return student

    mentor_ids = await _mentor_student_ids(db, current_user.id)
    if student_id not in mentor_ids:
        raise HTTPException(status_code=403, detail="Access denied")
    return student


def _note_response(note: StudentNote, student_name: str | None = None) -> StudentNoteResponse:
    return StudentNoteResponse(
        id=note.id,
        student_id=note.student_id,
        student_name=student_name,
        title=note.title,
        source_text=note.source_text,
        summary_markdown=note.summary_markdown,
        profile_snapshot=note.profile_snapshot or {},
        suggested_changes=note.suggested_changes or {},
        applied_changes=note.applied_changes or {},
        status=note.status,
        created_by=note.created_by,
        reviewed_by=note.reviewed_by,
        created_at=note.created_at,
        reviewed_at=note.reviewed_at,
    )


def _session_response(session: NoteSession, student_name: str | None = None, transcript_count: int = 0, latest_transcript: str | None = None) -> NoteSessionResponse:
    return NoteSessionResponse(
        id=session.id,
        student_id=session.student_id,
        student_name=student_name,
        note_id=session.note_id,
        meeting_id=session.meeting_id,
        title=session.title,
        source=session.source,
        status=session.status,
        started_at=session.started_at,
        ended_at=session.ended_at,
        last_heartbeat_at=session.last_heartbeat_at,
        created_by=session.created_by,
        transcript_count=transcript_count,
        latest_transcript=latest_transcript,
    )


async def _load_session_row(
    db: AsyncSession,
    session_id: uuid.UUID,
) -> tuple[NoteSession, str | None]:
    result = await db.execute(
        select(NoteSession, Student.full_name)
        .outerjoin(Student, Student.id == NoteSession.student_id)
        .where(NoteSession.id == session_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    return row[0], row[1]


async def _session_access_guard(db: AsyncSession, current_user, session: NoteSession) -> None:
    if session.student_id is None:
        if session.created_by != current_user.id and not _is_staff_admin(current_user):
            raise HTTPException(status_code=403, detail="Access denied")
        return
    if _is_staff_admin(current_user):
        return
    mentor_ids = await _mentor_student_ids(db, current_user.id)
    if session.student_id not in mentor_ids:
        raise HTTPException(status_code=403, detail="Access denied")


async def _session_context(db: AsyncSession, session_id: uuid.UUID, current_user) -> tuple[NoteSession, str | None]:
    session, student_name = await _load_session_row(db, session_id)
    await _session_access_guard(db, current_user, session)
    return session, student_name


@router.post("", response_model=NoteSessionResponse, status_code=201)
async def create_session(
    body: NoteSessionCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    student = None
    student_id = body.student_id
    if body.meeting_id:
        meeting = await db.get(Meeting, body.meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="Встреча не найдена")
        if body.student_id and body.student_id != meeting.student_id:
            raise HTTPException(status_code=409, detail="Встреча относится к другому студенту")
        student_id = meeting.student_id

    if student_id:
        student = await _load_accessible_student(db, current_user, student_id)

    if body.meeting_id:
        existing = await db.scalar(select(NoteSession).where(NoteSession.meeting_id == body.meeting_id))
        if existing:
            return _session_response(existing, student.full_name if student else None)

    title = (body.title or "").strip() or f"Конспект {datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M')}"
    row = NoteSession(
        student_id=student_id,
        meeting_id=body.meeting_id,
        title=title,
        source=(body.source or "deepgram").strip() or "deepgram",
        status=NoteSessionStatus.active,
        started_at=datetime.now(timezone.utc),
        last_heartbeat_at=datetime.now(timezone.utc),
        created_by=current_user.id,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not body.meeting_id:
            raise
        existing = await db.scalar(select(NoteSession).where(NoteSession.meeting_id == body.meeting_id))
        if not existing:
            raise
        return _session_response(existing, student.full_name if student else None)
    await db.refresh(row)
    return _session_response(row, student.full_name if student else None)


@router.get("", response_model=list[NoteSessionResponse])
async def list_sessions(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    student_id: uuid.UUID | None = None,
    status: NoteSessionStatus | None = None,
):
    latest_transcript_subquery = (
        select(NoteTranscript.text)
        .where(NoteTranscript.session_id == NoteSession.id)
        .order_by(NoteTranscript.sequence_no.desc())
        .limit(1)
        .correlate(NoteSession)
        .scalar_subquery()
    )
    transcript_count_subquery = (
        select(func.count(NoteTranscript.id))
        .where(NoteTranscript.session_id == NoteSession.id)
        .correlate(NoteSession)
        .scalar_subquery()
    )

    query = select(
        NoteSession,
        Student.full_name,
        transcript_count_subquery,
        latest_transcript_subquery,
    ).outerjoin(Student, Student.id == NoteSession.student_id)

    if student_id:
        query = query.where(NoteSession.student_id == student_id)

    if not _is_staff_admin(current_user):
        mentor_ids = await _mentor_student_ids(db, current_user.id)
        if mentor_ids:
            query = query.where(
                (NoteSession.student_id.is_(None) & (NoteSession.created_by == current_user.id))
                | NoteSession.student_id.in_(mentor_ids)
            )
        else:
            query = query.where(NoteSession.student_id.is_(None) & (NoteSession.created_by == current_user.id))

    if status:
        query = query.where(NoteSession.status == status)

    result = await db.execute(query.order_by(NoteSession.started_at.desc()))
    rows = result.all()
    return [
        _session_response(session, student_name, transcript_count or 0, latest_transcript)
        for session, student_name, transcript_count, latest_transcript in rows
    ]


@router.get("/{session_id}", response_model=NoteSessionDetail)
async def get_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, student_name = await _session_context(db, session_id, current_user)
    transcript_result = await db.execute(
        select(NoteTranscript)
        .where(NoteTranscript.session_id == session_id)
        .order_by(NoteTranscript.sequence_no.asc(), NoteTranscript.id.asc())
    )
    transcripts = [NoteTranscriptResponse.model_validate(row) for row in transcript_result.scalars()]
    note = None
    if session.note_id:
        note_result = await db.execute(
            select(StudentNote, Student.full_name)
            .outerjoin(Student, Student.id == StudentNote.student_id)
            .where(StudentNote.id == session.note_id)
        )
        note_row = note_result.first()
        if note_row:
            note = _note_response(note_row[0], note_row[1])

    transcript_count = len(transcripts)
    latest_transcript = transcripts[-1].text if transcripts else None
    response = _session_response(session, student_name, transcript_count, latest_transcript)
    return NoteSessionDetail(
        **response.model_dump(),
        transcripts=transcripts,
        note=note.model_dump() if note else None,
    )


@router.post("/{session_id}/heartbeat", status_code=204)
async def heartbeat(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, _ = await _session_context(db, session_id, current_user)
    if session.status == NoteSessionStatus.active:
        session.last_heartbeat_at = datetime.now(timezone.utc)
        await db.commit()


@router.patch("/{session_id}/end", response_model=NoteSessionResponse)
async def end_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, student_name = await _session_context(db, session_id, current_user)
    session.status = NoteSessionStatus.completed
    session.ended_at = datetime.now(timezone.utc)
    session.last_heartbeat_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(session)
    transcript_count = await db.scalar(select(func.count(NoteTranscript.id)).where(NoteTranscript.session_id == session_id))
    latest_transcript = await db.scalar(
        select(NoteTranscript.text)
        .where(NoteTranscript.session_id == session_id)
        .order_by(NoteTranscript.sequence_no.desc())
        .limit(1)
    )
    return _session_response(session, student_name, transcript_count or 0, latest_transcript)


@router.delete("/{session_id}")
async def delete_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, _ = await _session_context(db, session_id, current_user)
    chunk_result = await db.execute(
        select(NoteSessionAudioChunk.storage_path).where(NoteSessionAudioChunk.session_id == session.id)
    )
    storage_paths = [row[0] for row in chunk_result.all()]
    await db.delete(session)
    await db.commit()
    for storage_path in storage_paths:
        try:
            await minio_delete(storage_path)
        except Exception:
            logging.getLogger(__name__).exception(
                "Failed to delete audio chunk %s for removed session %s",
                storage_path,
                session_id,
            )
    return {"ok": True}


async def _chunk_to_response(chunk: NoteSessionAudioChunk) -> NoteSessionAudioChunkResponse:
    return NoteSessionAudioChunkResponse(
        id=chunk.id,
        session_id=chunk.session_id,
        chunk_index=chunk.chunk_index,
        file_size=chunk.file_size,
        status=chunk.status,
        transcript_text=chunk.transcript_text,
        download_url=await minio_url(chunk.storage_path),
        created_at=chunk.created_at,
    )


@router.post("/{session_id}/audio-chunks", response_model=NoteSessionAudioChunkResponse, status_code=201)
async def upload_audio_chunk(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    chunk_index: int = Form(...),
    file: UploadFile = File(...),
):
    """Backup-recording segment upload (safety net alongside the live
    Deepgram websocket stream) — see useAudioBackupRecorder.ts. Accepted
    regardless of session status: the last rotated segment can legitimately
    arrive just after the session was ended."""
    session, _ = await _session_context(db, session_id, current_user)

    content = await file.read()
    if len(content) > MAX_AUDIO_CHUNK_SIZE:
        raise HTTPException(status_code=413, detail="Аудиофрагмент слишком большой")

    existing = await db.execute(
        select(NoteSessionAudioChunk).where(
            NoteSessionAudioChunk.session_id == session_id,
            NoteSessionAudioChunk.chunk_index == chunk_index,
        )
    )
    existing_chunk = existing.scalar_one_or_none()
    if existing_chunk is not None:
        return await _chunk_to_response(existing_chunk)

    storage_path = await minio_upload_note_audio(
        content=content,
        session_id=session.id,
        filename=file.filename or f"chunk_{chunk_index}.webm",
        mime_type=file.content_type or "audio/webm",
    )
    chunk = NoteSessionAudioChunk(
        session_id=session.id,
        chunk_index=chunk_index,
        storage_path=storage_path,
        file_size=len(content),
    )
    db.add(chunk)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        try:
            await minio_delete(storage_path)
        except Exception:
            logging.getLogger(__name__).exception("Failed to clean up duplicate audio chunk %s", storage_path)
        existing_chunk = await db.scalar(
            select(NoteSessionAudioChunk).where(
                NoteSessionAudioChunk.session_id == session_id,
                NoteSessionAudioChunk.chunk_index == chunk_index,
            )
        )
        if not existing_chunk:
            raise
        return await _chunk_to_response(existing_chunk)
    except Exception:
        await db.rollback()
        try:
            await minio_delete(storage_path)
        except Exception:
            logging.getLogger(__name__).exception("Failed to clean up audio chunk %s", storage_path)
        raise
    await db.refresh(chunk)
    return await _chunk_to_response(chunk)


@router.get("/{session_id}/audio-chunks", response_model=list[NoteSessionAudioChunkResponse])
async def list_audio_chunks(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, _ = await _session_context(db, session_id, current_user)
    result = await db.execute(
        select(NoteSessionAudioChunk)
        .where(NoteSessionAudioChunk.session_id == session.id)
        .order_by(NoteSessionAudioChunk.chunk_index)
    )
    return [await _chunk_to_response(c) for c in result.scalars()]


@router.post("/{session_id}/reconcile-audio", response_model=NoteSessionReconcileResponse)
async def reconcile_audio(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Re-transcribes every backup segment that hasn't been transcribed yet
    via Deepgram's pre-recorded REST API, and stitches the results into
    session.backup_transcript_text — a second, independent transcript the
    manager can compare against the live one rather than a silent auto-merge
    (gap-detection between the two sources isn't reliable enough to trust)."""
    session, _ = await _session_context(db, session_id, current_user)
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
            logging.getLogger(__name__).exception(
                "Failed to reconcile audio chunk %s for session %s", chunk.id, session_id
            )
            chunk.status = NoteAudioChunkStatus.failed

    session.backup_transcript_text = " ".join(
        c.transcript_text.strip() for c in chunks if c.transcript_text and c.transcript_text.strip()
    )
    await db.commit()
    for chunk in chunks:
        await db.refresh(chunk)

    return NoteSessionReconcileResponse(
        backup_transcript_text=session.backup_transcript_text or "",
        chunks=[await _chunk_to_response(c) for c in chunks],
    )


@router.post("/{session_id}/transcripts", response_model=NoteTranscriptResponse, status_code=201)
async def add_transcript(
    session_id: uuid.UUID,
    body: NoteTranscriptCreate,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, _ = await _session_context(db, session_id, current_user)
    if session.status != NoteSessionStatus.active:
        raise HTTPException(status_code=409, detail="Сессия уже завершена")

    if body.client_segment_id:
        existing = await db.scalar(
            select(NoteTranscript).where(
                NoteTranscript.session_id == session_id,
                NoteTranscript.client_segment_id == body.client_segment_id,
            )
        )
        if existing:
            return NoteTranscriptResponse.model_validate(existing)

    for _ in range(5):
        current_max = await db.scalar(
            select(func.max(NoteTranscript.sequence_no)).where(NoteTranscript.session_id == session_id)
        )
        sequence_no = (current_max if current_max is not None else -1) + 1
        row = NoteTranscript(
            session_id=session_id,
            text=body.text.strip(),
            timestamp=body.timestamp or datetime.now(timezone.utc),
            speaker=body.speaker,
            client_segment_id=body.client_segment_id,
            sequence_no=sequence_no,
        )
        db.add(row)
        session.last_heartbeat_at = datetime.now(timezone.utc)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            if body.client_segment_id:
                existing = await db.scalar(
                    select(NoteTranscript).where(
                        NoteTranscript.session_id == session_id,
                        NoteTranscript.client_segment_id == body.client_segment_id,
                    )
                )
                if existing:
                    return NoteTranscriptResponse.model_validate(existing)
            continue
        await db.refresh(row)
        return NoteTranscriptResponse.model_validate(row)

    raise HTTPException(status_code=409, detail="Не удалось сохранить фрагмент, попробуйте снова")


@router.post("/{session_id}/draft", response_model=NoteSessionDraftResponse)
async def draft_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, student_name = await _session_context(db, session_id, current_user)
    transcript_result = await db.execute(
        select(NoteTranscript)
        .where(NoteTranscript.session_id == session_id)
        .order_by(NoteTranscript.sequence_no.asc(), NoteTranscript.id.asc())
    )
    transcripts = list(transcript_result.scalars())
    source_text = _session_source_text(session, transcripts)
    snapshot = {}
    if session.student_id:
        student = await _load_accessible_student(db, current_user, session.student_id)
        snapshot = snapshot_student(student)
    draft = await generate_note_draft(
        transcript=source_text,
        title=session.title,
        snapshot=snapshot,
        student_name=student_name,
    )
    ai_meta = _ai_meta(draft)
    _add_note_ai_run(
        db,
        session=session,
        student_id=session.student_id,
        source_text=source_text,
        snapshot=snapshot,
        draft=draft,
        ai_meta=ai_meta,
        current_user=current_user,
        status="draft_created",
    )
    await db.commit()
    return NoteSessionDraftResponse(
        title=draft["title"],
        source_text=source_text,
        summary_markdown=draft["summary_markdown"],
        profile_snapshot=snapshot,
        suggested_changes=draft["suggested_changes"],
        change_preview=render_change_preview(snapshot, draft["suggested_changes"]),
        ai_model=ai_meta.get("model"),
    )


@router.post("/{session_id}/finalize", response_model=NoteSessionFinalizeResponse)
async def finalize_session(
    session_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    session, student_name = await _session_context(db, session_id, current_user)
    locked_session = await db.scalar(
        select(NoteSession).where(NoteSession.id == session_id).with_for_update()
    )
    if not locked_session:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    session = locked_session
    if session.note_id:
        note_result = await db.execute(
            select(StudentNote, Student.full_name)
            .outerjoin(Student, Student.id == StudentNote.student_id)
            .where(StudentNote.id == session.note_id)
        )
        note_row = note_result.first()
        if not note_row:
            raise HTTPException(status_code=404, detail="Конспект не найден")
        existing_note = _note_response(note_row[0], note_row[1])
        return NoteSessionFinalizeResponse(
            session=_session_response(session, student_name),
            note=existing_note.model_dump(),
        )

    transcript_result = await db.execute(
        select(NoteTranscript)
        .where(NoteTranscript.session_id == session_id)
        .order_by(NoteTranscript.sequence_no.asc(), NoteTranscript.id.asc())
    )
    transcripts = list(transcript_result.scalars())
    source_text = _session_source_text(session, transcripts)

    snapshot = {}
    student = None
    if session.student_id:
        student = await _load_accessible_student(db, current_user, session.student_id)
        snapshot = snapshot_student(student)

    draft = await generate_note_draft(
        transcript=source_text,
        title=session.title,
        snapshot=snapshot,
        student_name=student.full_name if student else student_name,
    )
    ai_meta = _ai_meta(draft)

    note = StudentNote(
        student_id=session.student_id,
        title=draft["title"],
        source_text=source_text.strip(),
        summary_markdown=draft["summary_markdown"],
        profile_snapshot=snapshot,
        suggested_changes=draft["suggested_changes"],
        applied_changes={},
        status=StudentNoteStatus.draft,
        created_by=current_user.id,
        reviewed_by=None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(note)
    _add_note_ai_run(
        db,
        session=session,
        student_id=session.student_id,
        source_text=source_text,
        snapshot=snapshot,
        draft=draft,
        ai_meta=ai_meta,
        current_user=current_user,
        status="note_created",
    )
    await db.flush()

    session.note_id = note.id
    session.status = NoteSessionStatus.completed
    session.ended_at = datetime.now(timezone.utc)
    session.last_heartbeat_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(session)
    await db.refresh(note)

    return NoteSessionFinalizeResponse(
        session=_session_response(session, student.full_name if student else student_name),
        note=_note_response(note, student.full_name if student else student_name).model_dump(),
    )
