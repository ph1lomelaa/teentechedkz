"""Link Notion form blocks to backing databases and auto-attach questionnaires.

Two passes:
  1. resolve — for every task's `questionnaire_url` ("/p/<form-block-id>"), ask
     Notion for the block's parent database (the form's backing DB), import/refresh
     that database as a QuestionnaireTemplate and record `source_form_block_id`.
  2. attach — for every active roadmap task with a form link, materialize the
     native Questionnaire from its matched template (offline).

Usage:
    python -m app.core.link_notion_questionnaires            # resolve + attach
    python -m app.core.link_notion_questionnaires --attach-only
"""
from __future__ import annotations

import argparse
import asyncio
from typing import Callable

from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.import_notion_root_roadmaps import NotionClient
from app.core.import_notion_questionnaires import _db_title, _parse_title, _questions_from_db
from app.models.roadmap import RoadmapTask, Roadmap, RoadmapStatus
from app.models.questionnaire_template import QuestionnaireTemplate
from app.models.questionnaire import Questionnaire
from app.services.questionnaire_seed import extract_block_id, seed_questionnaire_for_task


async def _distinct_block_ids(db) -> list[str]:
    rows = await db.execute(text(
        "select distinct questionnaire_url from template_tasks where questionnaire_url is not null "
        "union select distinct questionnaire_url from roadmap_tasks where questionnaire_url is not null"
    ))
    ids: set[str] = set()
    for (url,) in rows.all():
        bid = extract_block_id(url)
        if bid:
            ids.add(bid)
    return sorted(ids)


async def resolve(on_event: Callable[[dict], None] | None = None, block_id: str | None = None) -> dict:
    if not settings.NOTION_API_KEY.strip():
        raise RuntimeError("NOTION_API_KEY не настроен")
    client = NotionClient(settings.NOTION_API_KEY)

    try:
        async with AsyncSessionLocal() as db:
            block_ids = [block_id] if block_id else await _distinct_block_ids(db)
            linked = imported = failed = 0
            for idx, bid in enumerate(block_ids):
                try:
                    block = await client.request("GET", f"/blocks/{bid}")
                    parent = block.get("parent", {})
                    db_id = parent.get("database_id")
                    if not db_id:
                        failed += 1
                        continue
                    dbjson = await client.request("GET", f"/databases/{db_id}")
                    title = _db_title(dbjson)
                    country, degree, step = _parse_title(title)
                    questions = _questions_from_db(dbjson, form_block_id=bid)
                    tpl = (
                        await db.execute(
                            select(QuestionnaireTemplate).where(QuestionnaireTemplate.source_notion_db_id == db_id)
                        )
                    ).scalar_one_or_none()
                    if tpl is None:
                        tpl = QuestionnaireTemplate(
                            source_notion_db_id=db_id, title=title, country_name=country,
                            degree=degree, step_name=step, questions=questions,
                        )
                        db.add(tpl)
                        imported += 1
                    else:
                        tpl.title = title
                        tpl.country_name = country
                        tpl.degree = degree
                        tpl.step_name = step
                        tpl.questions = questions
                    tpl.source_form_block_id = bid

                    # Fill missing descriptions in already materialized forms without
                    # overwriting any text a manager entered manually.
                    materialized = await db.execute(
                        select(Questionnaire)
                        .where(Questionnaire.source_notion_page_id == db_id)
                        .options(selectinload(Questionnaire.questions))
                    )
                    imported_by_label = {str(item.get("label", "")).strip().casefold(): item for item in questions}
                    for questionnaire in materialized.scalars().all():
                        for question in questionnaire.questions:
                            item = imported_by_label.get(question.label.strip().casefold())
                            if item and not question.help_text.strip():
                                question.help_text = str(item.get("help_text") or "")
                    linked += 1
                except Exception as exc:
                    failed += 1
                    if on_event:
                        on_event({"message": f"skip {bid}: {exc}"})
                if idx % 20 == 0:
                    await db.commit()
                    if on_event:
                        on_event({
                            "message": f"resolve {idx + 1}/{len(block_ids)}",
                            "index": idx + 1,
                            "total": len(block_ids),
                            "phase": "resolve",
                        })
            await db.commit()
        return {"blocks": len(block_ids), "linked": linked, "imported": imported, "failed": failed}
    finally:
        await client.aclose()


async def attach(on_event: Callable[[dict], None] | None = None) -> dict:
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(RoadmapTask)
            .join(Roadmap, Roadmap.id == RoadmapTask.roadmap_id)
            .where(RoadmapTask.questionnaire_url.is_not(None), Roadmap.status == RoadmapStatus.active)
        )
        tasks = list(rows.scalars().all())
        created = 0
        for idx, task in enumerate(tasks):
            if await seed_questionnaire_for_task(db, task, None):
                created += 1
            if idx % 50 == 0:
                await db.commit()
                if on_event:
                    on_event({
                        "message": f"attach {idx + 1}/{len(tasks)}",
                        "index": idx + 1,
                        "total": len(tasks),
                        "phase": "attach",
                    })
        await db.commit()
    return {"tasks": len(tasks), "created": created}


async def run(attach_only: bool = False, on_event: Callable[[dict], None] | None = None, block_id: str | None = None) -> dict:
    res_resolve = {} if attach_only else await resolve(on_event, block_id=block_id)
    res_attach = {} if block_id else await attach(on_event)
    return {"resolve": res_resolve, "attach": res_attach}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--attach-only", action="store_true")
    ap.add_argument("--block-id", default=None)
    args = ap.parse_args()
    result = asyncio.run(run(attach_only=args.attach_only, on_event=lambda e: print(e.get("message")), block_id=args.block_id))
    print("DONE", result)
