"""Knowledge base — curated reference content imported from Notion pages
(scholarship rules, mentor regulations, package tables). Read-only for staff;
resynced from Notion by admin/mzk_manager via a background job, same pattern
as /roadmap-templates/import/notion and /questionnaires/sync/notion.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.knowledge_article import KnowledgeArticle
from app.models.user import UserRole
from app.services import background_jobs

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
# Notion sync — job state persisted in background_jobs (survives restarts),
# same pattern as roadmap/questionnaire imports.
# --------------------------------------------------------------------------
_SYNC_JOB_KIND = "knowledge_sync"


@router.post("/sync/notion", status_code=202)
async def start_notion_knowledge_sync(current_user: CurrentUser):
    if current_user.role not in _MANAGE_ROLES:
        raise _FORBIDDEN
    running = await background_jobs.get_running_job(_SYNC_JOB_KIND)
    if running:
        raise HTTPException(status_code=409, detail={"message": "Синхронизация уже запущена", "job_id": str(running.id)})

    job = await background_jobs.create_job(_SYNC_JOB_KIND)

    async def runner() -> None:
        from app.core.import_notion_knowledge_pages import run_import

        on_event = background_jobs.make_on_event(job.id)
        try:
            result = await run_import(on_event=on_event)
            await background_jobs.finish_job(job.id, status="done", result=result)
        except Exception as exc:
            await background_jobs.finish_job(job.id, status="failed", error=str(exc))

    asyncio.create_task(runner())
    return background_jobs.serialize(job)


@router.get("/sync/notion/{job_id}")
async def get_notion_knowledge_sync_job(job_id: str, current_user: CurrentUser):
    if current_user.role not in _MANAGE_ROLES:
        raise _FORBIDDEN
    job = await background_jobs.get_job(_SYNC_JOB_KIND, job_id)
    if not job:
        raise _NOT_FOUND
    return background_jobs.serialize(job)
