"""Import root Notion roadmap databases into roadmap_templates.

Usage:
    python -m app.core.import_notion_root_roadmaps --dry-run
    python -m app.core.import_notion_root_roadmaps --only "USA UG"
    python -m app.core.import_notion_root_roadmaps --only "Foundation"

The importer treats Notion "КОРНЕВЫЕ РОУДМАПЫ 2026" databases as template
sources, not as live student roadmaps. It is idempotent by source_notion_db_id:
reruns update the template and replace its template stages/tasks/subtasks.
"""
from __future__ import annotations

import argparse
import asyncio
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable

import requests
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.country_flags_data import code_for, flag_for
from app.core.database import AsyncSessionLocal
from app.models.country_reference import CountryReference
from app.models.roadmap import (
    RoadmapTemplate,
    TaskAudience,
    TaskPriority,
    TemplateStage,
    TemplateSubtask,
    TemplateTask,
)
from migration.sources.notion import NOTION_VERSION, flatten_property


NOTION_BASE = "https://api.notion.com/v1"
SEARCH_QUERIES = ("Roadmap", "Все задачи", "Задачи", "FOUNDATION", "Italy", "Qatar")
STAGE_ORDER = ("Onboarding", "Pre-Admission", "Admission", "Post-Admission", "Off-boarding")
STAGE_POS = {name.lower(): i for i, name in enumerate(STAGE_ORDER)}

COUNTRY_EN_TO_RU = {
    "Australia": "Австралия",
    "Austria": "Австрия",
    "Canada": "Канада",
    "China": "Китай",
    "Czech Republic": "Чехия",
    "Czech Rep": "Чехия",
    "Germany": "Германия",
    "Hungary": "Венгрия",
    "Italy": "Италия",
    "Japan": "Япония",
    "Malaysia": "Малайзия",
    "Qatar": "Катар",
    "Turkey": "Турция",
    "UAE": "ОАЭ",
    "UK": "Великобритания",
    "USA": "США",
}


@dataclass(frozen=True)
class TemplateKey:
    country: str | None
    degree: str
    year: int
    track: str | None = None

    @property
    def label(self) -> str:
        if self.track:
            return self.track
        return f"{self.country} {self.degree}".strip()


@dataclass
class DatabaseCandidate:
    id: str
    title: str
    key: TemplateKey
    last_edited_time: datetime | None
    rows_count: int = 0


@dataclass
class ImportTemplateResult:
    title: str
    label: str
    source_notion_db_id: str
    action: str
    stages: int
    tasks: int
    subtasks: int


@dataclass
class ImportRunResult:
    ok: bool
    mode: str
    found: int = 0
    created: int = 0
    updated: int = 0
    tasks: int = 0
    subtasks: int = 0
    templates: list[ImportTemplateResult] | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "mode": self.mode,
            "found": self.found,
            "created": self.created,
            "updated": self.updated,
            "tasks": self.tasks,
            "subtasks": self.subtasks,
            "templates": [
                {
                    "title": item.title,
                    "label": item.label,
                    "source_notion_db_id": item.source_notion_db_id,
                    "action": item.action,
                    "stages": item.stages,
                    "tasks": item.tasks,
                    "subtasks": item.subtasks,
                }
                for item in (self.templates or [])
            ],
            "error": self.error,
        }


class NotionClient:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self._page_cache: dict[str, dict[str, Any]] = {}

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }

    def request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        url = f"{NOTION_BASE}{path}"
        for attempt in range(5):
            resp = requests.request(method, url, headers=self.headers, timeout=45, **kwargs)
            if resp.status_code == 429:
                wait = float(resp.headers.get("Retry-After", "1"))
                time.sleep(max(wait, 1.0))
                continue
            if 500 <= resp.status_code < 600 and attempt < 4:
                time.sleep(1 + attempt)
                continue
            if resp.status_code >= 400:
                try:
                    detail = resp.json().get("message", resp.text)
                except Exception:
                    detail = resp.text
                raise RuntimeError(f"Notion API {resp.status_code}: {detail}")
            return resp.json()
        raise RuntimeError("Notion API retries exhausted")

    def search_databases(self, query: str) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "query": query,
            "filter": {"value": "database", "property": "object"},
            "page_size": 100,
        }
        out: list[dict[str, Any]] = []
        while True:
            data = self.request("POST", "/search", json=payload)
            out.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            payload["start_cursor"] = data["next_cursor"]
        return out

    def query_database(self, database_id: str, page_size: int = 100) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"page_size": page_size}
        out: list[dict[str, Any]] = []
        while True:
            data = self.request("POST", f"/databases/{database_id}/query", json=payload)
            out.extend(data.get("results", []))
            if not data.get("has_more"):
                break
            payload["start_cursor"] = data["next_cursor"]
        return out

    def get_page(self, page_id: str) -> dict[str, Any]:
        if page_id not in self._page_cache:
            # Notion limit is low; keep this conservative and deterministic.
            time.sleep(0.34)
            self._page_cache[page_id] = self.request("GET", f"/pages/{page_id}")
        return self._page_cache[page_id]


def _plain_title(title: list[dict[str, Any]] | None) -> str:
    return "".join(part.get("plain_text", "") for part in (title or [])).strip()


def _db_title(db: dict[str, Any]) -> str:
    return _plain_title(db.get("title"))


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _has_master_schema(db: dict[str, Any]) -> bool:
    props = db.get("properties") or {}
    required = {
        "Task name": "title",
        "Этап": "multi_select",
        "Priority": "select",
        "Tasks (Шаблон)": "relation",
        "Краткий итог": "rich_text",
        "Результат": "rich_text",
    }
    return all((props.get(name) or {}).get("type") == ptype for name, ptype in required.items())


def _normalize_degree(raw: str | None) -> str:
    value = (raw or "").replace("’26", "").replace("'26", "").strip().lower()
    if value in {"ug", "undergraduate", "bachelor", "bachelors", "бакалавр"}:
        return "bachelors"
    if value in {"grad", "graduate", "master", "masters", "магистратура"}:
        return "masters"
    return value or "bachelors"


def _parse_key(title: str) -> TemplateKey | None:
    clean = re.sub(r"\s+", " ", title).replace("’", "'").strip()
    if "sample" in clean.lower() or "template)" in clean.lower():
        return None
    if "foundation" in clean.lower():
        return TemplateKey(country=None, degree="foundation", year=2026, track="Foundation")

    # Strip known prefixes/placeholders and keep the country/degree tail.
    tail = clean
    tail = re.sub(r"^Roadmap\s*\([^)]*\)\s*задач\s*", "", tail, flags=re.I)
    tail = re.sub(r"^Roadmap\s*задач\s*\([^)]*\)\s*", "", tail, flags=re.I)
    tail = re.sub(r"^Задачи\s*\([^)]*\)\s*", "", tail, flags=re.I)
    tail = tail.replace("'26", "").strip()
    if tail == clean:
        return None

    degree_match = re.search(r"\b(UG|Graduate|Grad)\b\s*$", tail, flags=re.I)
    if not degree_match:
        return None
    degree_raw = degree_match.group(1)
    country_raw = tail[: degree_match.start()].strip()
    if not country_raw:
        return None
    country_ru = COUNTRY_EN_TO_RU.get(country_raw, country_raw)
    return TemplateKey(country=country_ru, degree=_normalize_degree(degree_raw), year=2026)


def _priority(raw: Any) -> TaskPriority:
    value = str(raw or "").strip().lower()
    if value == "mandatory":
        return TaskPriority.required
    if value == "optional":
        return TaskPriority.optional
    return TaskPriority.recommended


def _prop(page: dict[str, Any], name: str) -> Any:
    prop = (page.get("properties") or {}).get(name)
    return flatten_property(prop) if prop else None


def _title_prop(page: dict[str, Any]) -> str:
    for prop in (page.get("properties") or {}).values():
        if prop.get("type") == "title":
            return str(flatten_property(prop) or "").strip()
    return ""


def _extract_first_url(prop: dict[str, Any] | None) -> str | None:
    if not prop:
        return None
    ptype = prop.get("type")
    items = prop.get(ptype) if ptype in {"title", "rich_text"} else []
    for item in items or []:
        href = item.get("href")
        if href:
            return href
        link = (item.get("text") or {}).get("link")
        if isinstance(link, dict) and link.get("url"):
            return link["url"]
        plain = item.get("plain_text") or ""
        m = re.search(r"https?://\S+", plain)
        if m:
            return m.group(0)
    return None


def _stage_names(value: Any) -> list[str]:
    raw = value if isinstance(value, list) else ([value] if value else [])
    return [str(v).strip() for v in raw if str(v or "").strip()]


def _stage_sort_key(name: str) -> tuple[int, str]:
    return (STAGE_POS.get(name.lower(), 999), name.lower())


async def _ensure_country(db: AsyncSession, country_name: str | None) -> CountryReference | None:
    if not country_name:
        return None
    res = await db.execute(
        select(CountryReference).where(func.lower(CountryReference.country_name) == country_name.lower())
    )
    existing = res.scalar_one_or_none()
    if existing:
        return existing
    emoji, url = flag_for(country_name)
    stmt = (
        pg_insert(CountryReference)
        .values(
            country_name=country_name,
            vpp_required=False,
            submission_deadline_notes=None,
            notes="Создано импортом Notion root roadmaps.",
            code=code_for(country_name),
            flag_emoji=emoji,
            flag_url=url,
        )
        .on_conflict_do_nothing(index_elements=["country_name"])
    )
    await db.execute(stmt)
    await db.flush()
    res = await db.execute(
        select(CountryReference).where(func.lower(CountryReference.country_name) == country_name.lower())
    )
    return res.scalar_one()


def discover_candidates(client: NotionClient) -> list[DatabaseCandidate]:
    seen: dict[str, dict[str, Any]] = {}
    for query in SEARCH_QUERIES:
        for db in client.search_databases(query):
            seen[db["id"]] = db

    candidates: list[DatabaseCandidate] = []
    for db in seen.values():
        if not _has_master_schema(db):
            continue
        title = _db_title(db)
        key = _parse_key(title)
        if not key:
            continue
        candidates.append(
            DatabaseCandidate(
                id=db["id"],
                title=title,
                key=key,
                last_edited_time=_parse_dt(db.get("last_edited_time")),
            )
        )
    return candidates


def build_structure(
    client: NotionClient,
    candidate: DatabaseCandidate,
    *,
    skip_subtasks: bool = False,
    on_task: Callable[[dict[str, Any]], None] | None = None,
) -> list[TemplateStage]:
    pages = client.query_database(candidate.id)
    candidate.rows_count = len(pages)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for page in pages:
        stages = _stage_names(_prop(page, "Этап"))
        stage_name = sorted(stages, key=_stage_sort_key)[0] if stages else "Без этапа"
        grouped.setdefault(stage_name, []).append(page)

    stages: list[TemplateStage] = []
    processed_tasks = 0
    for stage_pos, stage_name in enumerate(sorted(grouped, key=_stage_sort_key)):
        stage = TemplateStage(name=stage_name, position=stage_pos, description="")
        for task_pos, page in enumerate(grouped[stage_name]):
            props = page.get("properties") or {}
            relation_ids = _prop(page, "Tasks (Шаблон)") or []
            subtasks: list[TemplateSubtask] = []
            if not skip_subtasks:
                for sub_pos, sub_id in enumerate(relation_ids):
                    sub_page = client.get_page(sub_id)
                    title = _title_prop(sub_page)
                    if title:
                        subtasks.append(
                            TemplateSubtask(
                                title=title,
                                position=sub_pos,
                                source_notion_page_id=sub_page.get("id"),
                            )
                        )

            title = str(_prop(page, "Task name") or "").strip()
            if not title:
                title = "Без названия"
            task = TemplateTask(
                title=title,
                description=str(_prop(page, "Краткий итог") or "").strip(),
                expected_result=str(_prop(page, "Результат") or "").strip(),
                needs_document=bool(_prop(page, "Document")),
                needs_zoom=bool(_prop(page, "Zoom")),
                questionnaire_url=_extract_first_url(props.get("АНКЕТА")),
                source_notion_page_id=page.get("id"),
                priority=_priority(_prop(page, "Priority")),
                audience=TaskAudience.applicant,
                position=task_pos,
            )
            task.subtasks = subtasks
            stage.tasks.append(task)
            processed_tasks += 1
            if on_task:
                on_task({
                    "type": "task",
                    "task_index": processed_tasks,
                    "task_total": candidate.rows_count,
                    "title": title,
                    "subtasks": len(subtasks),
                    "subtasks_skipped": skip_subtasks,
                })
        stages.append(stage)
    return stages


async def upsert_template(
    db: AsyncSession,
    candidate: DatabaseCandidate,
    stages: list[TemplateStage],
    dry_run: bool,
) -> str:
    name = candidate.key.track or f"{candidate.key.country} {'UG' if candidate.key.degree == 'bachelors' else 'Graduate'}"
    if dry_run:
        return "planned"

    country = await _ensure_country(db, candidate.key.country)

    res = await db.execute(
        select(RoadmapTemplate).where(RoadmapTemplate.source_notion_db_id == candidate.id)
    )
    tpl = res.scalar_one_or_none()
    action = "updated" if tpl else "created"

    if tpl is None:
        tpl = RoadmapTemplate(
            name=name,
            country_name=candidate.key.country,
            country_ref_id=country.id if country else None,
            degree=candidate.key.degree,
            year=candidate.key.year,
            description="Импортировано из Notion root roadmaps.",
            source_notion_db_id=candidate.id,
        )
        db.add(tpl)
        await db.flush()
    else:
        old_stages = await db.execute(select(TemplateStage).where(TemplateStage.template_id == tpl.id))
        for old_stage in old_stages.scalars().all():
            await db.delete(old_stage)
        await db.flush()

    tpl.name = name
    tpl.country_name = candidate.key.country
    tpl.country_ref_id = country.id if country else None
    tpl.degree = candidate.key.degree
    tpl.year = candidate.key.year
    tpl.source_notion_title = candidate.title
    tpl.source_notion_last_edited_at = candidate.last_edited_time

    for stage in stages:
        stage.template_id = tpl.id
        db.add(stage)
    return action


def _dedupe(candidates: list[DatabaseCandidate], client: NotionClient) -> list[DatabaseCandidate]:
    by_key: dict[TemplateKey, DatabaseCandidate] = {}
    for candidate in candidates:
        # Count rows before choosing duplicates. This is slower but avoids importing
        # empty/partial duplicate databases.
        candidate.rows_count = len(client.query_database(candidate.id))
        current = by_key.get(candidate.key)
        if current is None:
            by_key[candidate.key] = candidate
            continue
        current_time = current.last_edited_time or datetime.min.replace(tzinfo=None)
        candidate_time = candidate.last_edited_time or datetime.min.replace(tzinfo=None)
        if (candidate.rows_count, candidate_time.isoformat()) > (current.rows_count, current_time.isoformat()):
            by_key[candidate.key] = candidate
    return sorted(by_key.values(), key=lambda c: (c.key.track or "", c.key.country or "", c.key.degree))


async def run_import_summary(
    *,
    dry_run: bool,
    only: str | None,
    discover_only: bool,
    skip_subtasks: bool,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> ImportRunResult:
    def emit(event: dict[str, Any]) -> None:
        if on_event:
            on_event(event)
        message = event.get("message")
        if message:
            print(message, flush=True)

    mode = "DISCOVER" if discover_only else ("DRY RUN" if dry_run else "APPLIED")
    if not settings.NOTION_API_KEY:
        return ImportRunResult(ok=False, mode=mode, error="NOTION_API_KEY не задан в backend .env", templates=[])

    client = NotionClient(settings.NOTION_API_KEY)
    candidates = discover_candidates(client)
    if only:
        needle = only.strip().lower()
        candidates = [c for c in candidates if needle in c.key.label.lower() or needle in c.title.lower()]
    if discover_only:
        emit({"type": "discover", "found": len(candidates), "message": f"Discovered master roadmap candidates: {len(candidates)}"})
        items: list[ImportTemplateResult] = []
        for c in sorted(candidates, key=lambda item: (item.key.track or "", item.key.country or "", item.key.degree, item.title)):
            emit({"type": "candidate", "title": c.title, "label": c.key.label, "source_notion_db_id": c.id, "message": f"- {c.title} → {c.key.label} · {c.id}"})
            items.append(ImportTemplateResult(c.title, c.key.label, c.id, "found", 0, 0, 0))
        return ImportRunResult(ok=bool(candidates), mode=mode, found=len(candidates), templates=items)

    candidates = _dedupe(candidates, client)

    emit({"type": "deduped", "found": len(candidates), "message": f"Found master roadmap templates: {len(candidates)}"})
    if not candidates:
        return ImportRunResult(ok=False, mode=mode, found=0, templates=[], error="Notion roadmap templates не найдены")

    created = updated = total_tasks = total_subtasks = 0
    items: list[ImportTemplateResult] = []
    for idx, candidate in enumerate(candidates, start=1):
        async with AsyncSessionLocal() as db:
            emit({
                "type": "template_start",
                "index": idx,
                "total": len(candidates),
                "title": candidate.title,
                "label": candidate.key.label,
                "message": f"[{idx}/{len(candidates)}] {candidate.title} → {candidate.key.label}",
            })
            try:
                def task_event(event: dict[str, Any]) -> None:
                    event.update({
                        "template_index": idx,
                        "template_total": len(candidates),
                        "template_title": candidate.title,
                    })
                    subtasks_part = "subtasks skipped" if event["subtasks_skipped"] else f"subtasks={event['subtasks']}"
                    event["message"] = f"    task {event['task_index']}/{event['task_total']}: {event['title']} · {subtasks_part}"
                    emit(event)

                stages = build_structure(client, candidate, skip_subtasks=skip_subtasks, on_task=task_event)
                task_count = sum(len(s.tasks) for s in stages)
                subtask_count = sum(len(t.subtasks) for s in stages for t in s.tasks)
                action = await upsert_template(db, candidate, stages, dry_run=dry_run)
                if dry_run:
                    await db.rollback()
                else:
                    await db.commit()
                created += int(action == "created")
                updated += int(action == "updated")
                total_tasks += task_count
                total_subtasks += subtask_count
                items.append(ImportTemplateResult(
                    title=candidate.title,
                    label=candidate.key.label,
                    source_notion_db_id=candidate.id,
                    action=action,
                    stages=len(stages),
                    tasks=task_count,
                    subtasks=subtask_count,
                ))
                emit({
                    "type": "template_done",
                    "index": idx,
                    "total": len(candidates),
                    "action": action,
                    "stages": len(stages),
                    "tasks": task_count,
                    "subtasks": subtask_count,
                    "message": f"  {action}: stages={len(stages)} tasks={task_count} subtasks={subtask_count}",
                })
            except Exception:
                await db.rollback()
                raise

    emit({"type": "done", "message": f"{mode}: created={created} updated={updated} tasks={total_tasks} subtasks={total_subtasks}"})
    return ImportRunResult(
        ok=True,
        mode=mode,
        found=len(candidates),
        created=created,
        updated=updated,
        tasks=total_tasks,
        subtasks=total_subtasks,
        templates=items,
    )


async def run_import(*, dry_run: bool, only: str | None, discover_only: bool, skip_subtasks: bool) -> int:
    result = await run_import_summary(
        dry_run=dry_run,
        only=only,
        discover_only=discover_only,
        skip_subtasks=skip_subtasks,
    )
    if result.error:
        print(f"ERROR: {result.error}", file=sys.stderr)
    return 0 if result.ok else 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Read Notion and report without DB writes.")
    parser.add_argument("--only", help='Import only templates matching label/title, e.g. "USA UG" or "Foundation".')
    parser.add_argument("--discover-only", action="store_true", help="Only list matching Notion databases; do not query rows.")
    parser.add_argument("--skip-subtasks", action="store_true", help="Import stages/tasks only. Useful for fast first pass.")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run_import(
        dry_run=args.dry_run,
        only=args.only,
        discover_only=args.discover_only,
        skip_subtasks=args.skip_subtasks,
    )))


if __name__ == "__main__":
    main()
