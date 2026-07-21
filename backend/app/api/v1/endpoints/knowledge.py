"""Knowledge base — curated reference content imported from Notion pages
(scholarship rules, mentor regulations, package tables). Read-only for staff;
resynced from Notion by admin/mzk_manager via a background job, same pattern
as /roadmap-templates/import/notion and /questionnaires/sync/notion.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.knowledge_article import KnowledgeArticle
from app.models.user import UserRole

router = APIRouter(prefix="/knowledge-articles", tags=["knowledge"])

STAFF = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
_MANAGE_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_NOT_FOUND = HTTPException(status_code=404, detail="Не найдено")


def _summary(a: KnowledgeArticle) -> dict:
    return {
        "id": str(a.id),
        "title": a.title,
        "category": a.category,
        "source_notion_url": a.source_notion_url,
        "synced_at": a.synced_at.isoformat() if a.synced_at else None,
    }


def _detail(a: KnowledgeArticle) -> dict:
    return {**_summary(a), "body_html": a.body_html}


@router.get("")
async def list_articles(
    current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
    category: str | None = None,
):
    if current_user.role not in STAFF:
        raise _FORBIDDEN
    stmt = select(KnowledgeArticle).order_by(KnowledgeArticle.category, KnowledgeArticle.title)
    if category:
        stmt = stmt.where(KnowledgeArticle.category == category)
    res = await db.execute(stmt)
    return [_summary(a) for a in res.scalars().all()]


@router.get("/{article_id}")
async def get_article(
    article_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in STAFF:
        raise _FORBIDDEN
    article = await db.get(KnowledgeArticle, article_id)
    if not article:
        raise _NOT_FOUND
    return _detail(article)


# --------------------------------------------------------------------------
# Notion sync — same in-memory job pattern as roadmap/questionnaire imports.
# --------------------------------------------------------------------------
_SYNC_JOBS: dict[str, dict] = {}


def _job_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("/sync/notion", status_code=202)
async def start_notion_knowledge_sync(current_user: CurrentUser):
    if current_user.role not in _MANAGE_ROLES:
        raise _FORBIDDEN
    running = next((job for job in _SYNC_JOBS.values() if job.get("status") == "running"), None)
    if running:
        raise HTTPException(status_code=409, detail={"message": "Синхронизация уже запущена", "job_id": running["job_id"]})

    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "status": "running",
        "started_at": _job_now(),
        "finished_at": None,
        "events": [],
        "result": None,
        "error": None,
    }
    _SYNC_JOBS[job_id] = job

    async def runner() -> None:
        from app.core.import_notion_knowledge_pages import run_import

        def on_event(event: dict) -> None:
            job["events"].append({"at": _job_now(), **event})
            job["events"] = job["events"][-80:]

        try:
            job["result"] = await run_import(on_event=on_event)
            job["status"] = "done"
        except Exception as exc:
            job["status"] = "failed"
            job["error"] = str(exc)
        finally:
            job["finished_at"] = _job_now()

    asyncio.create_task(runner())
    return job


@router.get("/sync/notion/{job_id}")
async def get_notion_knowledge_sync_job(job_id: str, current_user: CurrentUser):
    if current_user.role not in _MANAGE_ROLES:
        raise _FORBIDDEN
    job = _SYNC_JOBS.get(job_id)
    if not job:
        raise _NOT_FOUND
    return job
