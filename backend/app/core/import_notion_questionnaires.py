"""Import Notion form backing databases into questionnaire_templates.

Usage:
    python -m app.core.import_notion_questionnaires --limit 10       # quick check
    python -m app.core.import_notion_questionnaires --only "ONBOARDING"
    python -m app.core.import_notion_questionnaires                  # full run

Notion Forms themselves are not exposed by the API, but each form writes into a
backing database titled `<Country> <Degree> ⇒ <STEP>` whose properties are the
questions. Idempotent by source_notion_db_id.
"""
from __future__ import annotations

import argparse
import asyncio
import re
from typing import Any, Callable
from urllib.parse import unquote

import requests

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.import_notion_root_roadmaps import NotionClient
from app.models.questionnaire_template import QuestionnaireTemplate

# Notion property types that are not student-answerable questions.
SKIP_TYPES = {
    "created_time", "created_by", "last_edited_time", "last_edited_by",
    "people", "files", "relation", "rollup", "formula", "button", "unique_id",
}

# Notion property type -> our QuestionKind value.
KIND_MAP = {
    "title": "text",
    "rich_text": "long_text",
    "select": "choice",
    "status": "choice",
    "multi_select": "multi",
    "checkbox": "bool",
    "number": "text",
    "email": "text",
    "phone_number": "text",
    "url": "text",
    "date": "text",
}


def _db_title(d: dict[str, Any]) -> str:
    return "".join(p.get("plain_text", "") for p in d.get("title", [])).strip()


def _parse_title(title: str) -> tuple[str | None, str | None, str | None]:
    left, _, step = title.partition("⇒")
    left = left.strip()
    step = step.strip() or None
    low = left.lower()
    if "graduate" in low or "master" in low:
        degree: str | None = "masters"
    elif "ug" in low.split() or "undergrad" in low:
        degree = "bachelors"
    else:
        degree = None
    country = re.sub(r"\b(graduate|undergraduate|undergrad|ug|grad|masters?)\b", "", left, flags=re.I).strip()
    return (country or None), degree, step


NOTION_PUBLIC_FORM_CHUNK = "https://www.notion.so/api/v3/loadPageChunk"


def _legacy_rich_text_plain(value: Any) -> str:
    """Flatten Notion's internal rich-text tuples used by form_question config."""
    if not isinstance(value, list):
        return ""
    return "".join(
        str(part[0])
        for part in value
        if isinstance(part, list) and part and isinstance(part[0], str)
    ).strip()


def _public_form_payload(form_block_id: str) -> dict[str, Any] | None:
    """Read question captions from a published Notion form.

    The official API returns form blocks as unsupported and omits their question
    descriptions. Published forms expose a read-only page chunk containing only
    form structure (not respondent answers), which lets us preserve the captions
    users see in Notion. Failure is deliberately non-fatal: database properties
    remain a valid fallback.
    """
    page_id = re.sub(r"[^0-9a-fA-F]", "", form_block_id)
    if len(page_id) != 32:
        return None
    dashed = f"{page_id[:8]}-{page_id[8:12]}-{page_id[12:16]}-{page_id[16:20]}-{page_id[20:]}"
    try:
        response = requests.post(
            NOTION_PUBLIC_FORM_CHUNK,
            json={
                "pageId": dashed,
                "limit": 100,
                "cursor": {"stack": []},
                "chunkNumber": 0,
                "verticalColumns": False,
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None


def _form_question_configs(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not payload:
        return []
    record_map = payload.get("recordMap") or {}
    raw_questions = record_map.get("form_question") or {}
    configs: dict[str, dict[str, Any]] = {}
    for question_id, wrapped in raw_questions.items():
        value = (((wrapped or {}).get("value") or {}).get("value") or {})
        config = value.get("config") or {}
        if config:
            configs[question_id] = config

    ordered_ids: list[str] = []
    for wrapped in (record_map.get("layout") or {}).values():
        value = (((wrapped or {}).get("value") or {}).get("value") or {})
        for module in ((value.get("modules") or {}).get("form_layout_schema") or []):
            if module.get("type") == "formQuestion" and module.get("formQuestionId"):
                ordered_ids.append(module["formQuestionId"])
    if not ordered_ids:
        ordered_ids = list(configs)
    return [configs[qid] for qid in ordered_ids if qid in configs]


def _questions_from_db(
    dbjson: dict[str, Any],
    form_block_id: str | None = None,
    form_payload: dict[str, Any] | None = None,
) -> list[dict]:
    out: list[dict] = []
    pos = 0
    by_property_id: dict[str, dict[str, Any]] = {}
    by_name: dict[str, dict[str, Any]] = {}
    for name, meta in dbjson.get("properties", {}).items():
        ptype = meta.get("type")
        if ptype in SKIP_TYPES:
            continue
        kind = KIND_MAP.get(ptype)
        if not kind:
            continue
        options: list[str] = []
        if ptype in ("select", "status", "multi_select"):
            options = [o.get("name") for o in meta.get(ptype, {}).get("options", []) if o.get("name")]
        help_text = str(meta.get("description") or meta.get(ptype, {}).get("description") or "").strip()
        question = {
            "kind": kind,
            "label": name,
            "help_text": help_text,
            "options": options,
            "required": False,
            "position": pos,
        }
        out.append(question)
        property_id = unquote(str(meta.get("id") or ""))
        if property_id:
            by_property_id[property_id] = question
        by_name[name.strip().casefold()] = question
        pos += 1

    payload = form_payload if form_payload is not None else (_public_form_payload(form_block_id) if form_block_id else None)
    configs = _form_question_configs(payload)
    if not configs:
        return out

    ordered: list[dict[str, Any]] = []
    used: set[int] = set()
    for config in configs:
        form_name = _legacy_rich_text_plain(config.get("name"))
        base = by_property_id.get(str(config.get("propertyId") or "")) or by_name.get(form_name.casefold())
        if not base:
            continue
        question = dict(base)
        question["label"] = form_name or question["label"]
        question["help_text"] = _legacy_rich_text_plain(config.get("description")) or question["help_text"]
        question["required"] = bool(config.get("required"))
        type_config = config.get("propertyTypeSpecificConfig") or {}
        if (type_config.get("text") or {}).get("longAnswer"):
            question["kind"] = "long_text"
        question["position"] = len(ordered)
        ordered.append(question)
        used.add(id(base))
    for question in out:
        if id(question) not in used:
            copied = dict(question)
            copied["position"] = len(ordered)
            ordered.append(copied)
    return ordered


async def run(only: str | None = None, limit: int | None = None, on_event: Callable[[dict], None] | None = None) -> dict:
    if not settings.NOTION_API_KEY.strip():
        raise RuntimeError("NOTION_API_KEY не настроен")
    client = NotionClient(settings.NOTION_API_KEY)

    try:
        seen: dict[str, str] = {}
        for d in await client.search_databases("⇒"):
            title = _db_title(d)
            if "⇒" in title:
                seen[d["id"]] = title
        items = list(seen.items())
        if only:
            items = [(i, t) for i, t in items if only.lower() in t.lower()]
        if limit:
            items = items[:limit]

        created = updated = skipped = 0
        async with AsyncSessionLocal() as db:
            for idx, (dbid, title) in enumerate(items):
                try:
                    dbjson = await client.request("GET", f"/databases/{dbid}")
                except Exception as exc:
                    skipped += 1
                    if on_event:
                        on_event({"message": f"skip {title}: {exc}"})
                    continue
                questions = _questions_from_db(dbjson)
                country, degree, step = _parse_title(title)
                existing = (
                    await db.execute(
                        select(QuestionnaireTemplate).where(QuestionnaireTemplate.source_notion_db_id == dbid)
                    )
                ).scalar_one_or_none()
                if existing:
                    existing.title = title
                    existing.country_name = country
                    existing.degree = degree
                    existing.step_name = step
                    existing.questions = questions
                    updated += 1
                else:
                    db.add(QuestionnaireTemplate(
                        source_notion_db_id=dbid, title=title, country_name=country,
                        degree=degree, step_name=step, questions=questions,
                    ))
                    created += 1
                if idx % 20 == 0:
                    await db.commit()
                    if on_event:
                        on_event({"message": f"{idx + 1}/{len(items)}", "index": idx + 1, "total": len(items)})
            await db.commit()
        return {"found": len(items), "created": created, "updated": updated, "skipped": skipped}
    finally:
        await client.aclose()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    result = asyncio.run(run(only=args.only, limit=args.limit, on_event=lambda e: print(e.get("message"))))
    print("DONE", result)
