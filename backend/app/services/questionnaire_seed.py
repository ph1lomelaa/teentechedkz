"""Offline seeding of native questionnaires onto roadmap tasks.

A roadmap/template task stores its Notion form link in `questionnaire_url`
("/p/<form-block-id>"). We resolve that block id to a `QuestionnaireTemplate`
(linked via `source_form_block_id`) and materialize a native Questionnaire with
its questions on the task — no Notion call needed at this point, so it is safe to
run during roadmap assignment.
"""
from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.roadmap import RoadmapTask, Roadmap
from app.models.questionnaire import Questionnaire, QuestionnaireQuestion, QuestionKind
from app.models.questionnaire_template import QuestionnaireTemplate


def extract_block_id(url: str | None) -> str | None:
    """"/p/85b8111c...d197d5" (or any Notion href) -> 32-hex id, lowercased."""
    if not url:
        return None
    hexed = re.sub(r"[^0-9a-fA-F]", "", url)
    return hexed[-32:].lower() if len(hexed) >= 32 else None


async def template_for_task(db: AsyncSession, task: RoadmapTask) -> QuestionnaireTemplate | None:
    bid = extract_block_id(task.questionnaire_url)
    if not bid:
        return None
    res = await db.execute(
        select(QuestionnaireTemplate).where(QuestionnaireTemplate.source_form_block_id == bid)
    )
    return res.scalar_one_or_none()


async def seed_questionnaire_for_task(
    db: AsyncSession, task: RoadmapTask, created_by: uuid.UUID | None
) -> bool:
    """Create a draft Questionnaire on the task from its matched Notion template.

    No-op (returns False) if the task has no matchable form, the template has no
    questions, or a questionnaire already exists. Caller is responsible for commit.
    """
    tpl = await template_for_task(db, task)
    if not tpl or not tpl.questions:
        return False

    student_id = (
        await db.execute(select(Roadmap.student_id).where(Roadmap.id == task.roadmap_id))
    ).scalar_one_or_none()
    if not student_id:
        return False

    exists = (
        await db.execute(select(Questionnaire.id).where(Questionnaire.roadmap_task_id == task.id))
    ).scalar_one_or_none()
    if exists:
        return False

    q = Questionnaire(
        roadmap_task_id=task.id, student_id=student_id, title=tpl.title,
        source_notion_page_id=tpl.source_notion_db_id, created_by=created_by,
    )
    db.add(q)
    await db.flush()
    for i, item in enumerate(tpl.questions or []):
        db.add(QuestionnaireQuestion(
            questionnaire_id=q.id,
            kind=QuestionKind(item.get("kind", "text")),
            label=item.get("label", ""),
            help_text=item.get("help_text") or item.get("description") or "",
            required=bool(item.get("required")),
            options=item.get("options") or [],
            position=i,
        ))
    return True
