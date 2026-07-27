"""DB-backed tracker for long-running staff-triggered jobs (Notion sync/import
runs). Replaces the old per-endpoint in-memory `dict[str, dict]` pattern so
progress/results survive a backend restart or deploy instead of vanishing.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.models.background_job import BackgroundJob

# A "running" job is only treated as stale (dead process) when BOTH: its id is
# not among the jobs this process is actively running (_LIVE_JOBS), AND it hasn't
# reported activity for this long. The liveness set is what distinguishes a slow-
# but-alive job (long Notion rate-limit backoff, big import) from one whose owner
# actually died — a restart/crash empties _LIVE_JOBS, so its still-"running" rows
# fall through to the timeout and get cleaned up, while a live slow job never does.
STALE_JOB_TIMEOUT = timedelta(minutes=10)

# Job ids currently being run by *this* process (added in create_job, removed in
# finish_job). In-memory on purpose: it resets to empty on restart, which is
# exactly how we detect that a previously-"running" job was orphaned.
_LIVE_JOBS: set[uuid.UUID] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _last_activity(job: BackgroundJob) -> datetime:
    events = job.events or []
    if events:
        try:
            return datetime.fromisoformat(events[-1]["at"])
        except (KeyError, ValueError, TypeError):
            pass
    return job.started_at


def serialize(job: BackgroundJob) -> dict:
    return {
        "job_id": str(job.id),
        "status": job.status,
        "started_at": job.started_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "request": job.request,
        "progress": job.progress,
        "events": job.events or [],
        "result": job.result,
        "error": job.error,
    }


def _is_stale(job: BackgroundJob) -> bool:
    if job.status != "running" or job.id in _LIVE_JOBS:
        return False
    return _now() - _last_activity(job) > STALE_JOB_TIMEOUT


async def _mark_stale_failed(job: BackgroundJob) -> None:
    """Flip a job whose owning process died (crash/restart/deploy) from a
    forever-'running' state to 'failed', so pollers stop and new syncs unblock."""
    await finish_job(
        job.id,
        status="failed",
        error="Джоб помечен как зависший: не было прогресса дольше "
        f"{int(STALE_JOB_TIMEOUT.total_seconds() // 60)} минут (вероятно, процесс перезапустился).",
    )


async def get_running_job(kind: str) -> BackgroundJob | None:
    async with AsyncSessionLocal() as db:
        job = (
            await db.execute(
                select(BackgroundJob).where(BackgroundJob.kind == kind, BackgroundJob.status == "running")
            )
        ).scalars().first()
    if job is None:
        return None
    if _is_stale(job):
        await _mark_stale_failed(job)
        return None
    return job


async def create_job(kind: str, request: dict | None = None, progress: dict | None = None) -> BackgroundJob:
    async with AsyncSessionLocal() as db:
        job = BackgroundJob(
            id=uuid.uuid4(), kind=kind, status="running", started_at=_now(),
            request=request, progress=progress, events=[],
        )
        db.add(job)
        await db.commit()
        await db.refresh(job)
        _LIVE_JOBS.add(job.id)
        return job


async def get_job(kind: str, job_id: str) -> BackgroundJob | None:
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        return None
    async with AsyncSessionLocal() as db:
        job = await db.get(BackgroundJob, job_uuid)
    if not job or job.kind != kind:
        return None
    # A job stuck in 'running' because its process died would otherwise keep
    # frontend pollers looping forever — flip it to 'failed' on read too, not
    # only when a new sync tries to start (get_running_job).
    if _is_stale(job):
        await _mark_stale_failed(job)
        async with AsyncSessionLocal() as db:
            job = await db.get(BackgroundJob, job_uuid)
    return job


async def list_jobs(kind: str, limit: int = 10) -> list[BackgroundJob]:
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(BackgroundJob)
            .where(BackgroundJob.kind == kind)
            .order_by(BackgroundJob.started_at.desc())
            .limit(limit)
        )
        return list(rows.scalars().all())


async def _append_event(job_id: uuid.UUID, event: dict) -> None:
    async with AsyncSessionLocal() as db:
        job = await db.get(BackgroundJob, job_id)
        if not job:
            return
        events = list(job.events or [])
        events.append({"at": _now().isoformat(), **event})
        job.events = events[-120:]

        progress = dict(job.progress or {})
        if event.get("message"):
            progress["message"] = event["message"]
        for key in ("index", "total", "phase", "template_index", "template_total", "task_index", "task_total", "title"):
            if key in event:
                progress[key] = event[key]
        if "index" in event and "template_index" not in event:
            progress["template_index"] = event["index"]
        if "total" in event and "template_total" not in event:
            progress["template_total"] = event["total"]
        job.progress = progress
        await db.commit()


def make_on_event(job_id: uuid.UUID):
    """Sync callback usable as `on_event` by the existing core import/sync
    functions — schedules the DB write without forcing every call site to
    become async."""
    def on_event(event: dict) -> None:
        asyncio.create_task(_append_event(job_id, event))
    return on_event


async def finish_job(job_id: uuid.UUID, *, status: str, result: dict | None = None, error: str | None = None) -> None:
    _LIVE_JOBS.discard(job_id)
    async with AsyncSessionLocal() as db:
        job = await db.get(BackgroundJob, job_id)
        if not job:
            return
        job.status = status
        job.result = result
        job.error = error
        job.finished_at = _now()
        await db.commit()


async def upsert_status(kind: str, *, ok: bool, error: str | None, counters: dict | None) -> None:
    """Single persisted row per `kind` for periodic sync heartbeats (sheets,
    Notion pipeline sync) — no job_id involved, just "last run" status."""
    async with AsyncSessionLocal() as db:
        job = (
            await db.execute(select(BackgroundJob).where(BackgroundJob.kind == kind))
        ).scalars().first()
        now = _now()
        if not job:
            job = BackgroundJob(id=uuid.uuid4(), kind=kind, started_at=now)
            db.add(job)
        job.status = "done" if ok else "failed"
        job.finished_at = now
        job.result = {"counters": counters} if counters is not None else None
        job.error = error
        await db.commit()


async def get_status(kind: str) -> BackgroundJob | None:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(select(BackgroundJob).where(BackgroundJob.kind == kind))
        ).scalars().first()
