"""Import curated Notion reference pages into knowledge_articles.

Usage:
    python -m app.core.import_notion_knowledge_pages

Unlike roadmap templates (a fixed task-database schema) or questionnaires (a
fixed form-database schema), these are free-form Notion pages — scholarship
rules, mentor regulations, package tables — with no shared structure to
discover by search. The target list below is curated by hand (page id ->
category) and re-run is idempotent by source_notion_page_id.
"""
from __future__ import annotations

import argparse
import asyncio
import html
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.import_notion_root_roadmaps import NotionClient, _parse_dt, _plain_title
from app.models.knowledge_article import KnowledgeArticle
from migration.sources.notion import flatten_property

# page_id -> category label. Curated from the current "КОРНЕВЫЕ РОУДМАПЫ
# 2026" index (page 2024a5e7-9e3c-8025-a249-d92583ecdbd9). Keep explicit IDs:
# the page also contains dozens of roadmap/form sources that must not appear in
# the staff knowledge base.
TARGETS: list[dict[str, str]] = [
    {"page_id": "2654a5e7-9e3c-80b9-a1f9-e6d0d4ac74e5", "category": "Стипендии"},         # UK Chevening 2026
    {"page_id": "2654a5e7-9e3c-80e7-b015-e9d153feafa2", "category": "Стипендии"},         # Hungary Hungaricum
    {"page_id": "2674a5e7-9e3c-803e-90e4-f834229d90e1", "category": "Стипендии"},         # Italy Need-based
    {"page_id": "2674a5e7-9e3c-8057-922f-f0d9d65b7da3", "category": "Стипендии"},         # Korea GKS Undergraduate
    {"page_id": "2674a5e7-9e3c-805e-8365-e231f3555bf0", "category": "Стипендии"},         # Korea GKS Graduate
    {"page_id": "2684a5e7-9e3c-803a-b609-cd1bbc453677", "category": "Стипендии"},         # Korea merit-based
    {"page_id": "27e4a5e7-9e3c-80b3-8e87-c225b3c1c6e4", "category": "Мифы и разборы"},   # ОП - Разбор
    {"page_id": "2064a5e7-9e3c-80f9-9232-cb88b1651b4b", "category": "Регламенты"},        # Компания - Ментор
    {"page_id": "24b4a5e7-9e3c-8027-aa16-d751ecdb9f0b", "category": "Пакеты и выплаты"},  # Packages AUG'2025
    {"page_id": "2024a5e7-9e3c-804b-a46f-da0e42d55bad", "category": "Пакеты и выплаты"},  # Кураторы Packages Jun'2025
    {"page_id": "2be4a5e7-9e3c-81d7-b424-e6057b09d0a4", "category": "Пакеты и выплаты"},  # Кураторы Packages DEC'2025
    {"page_id": "2094a5e7-9e3c-80f7-ac55-ed6d274c43b5", "category": "Пакеты и выплаты"},  # Компания Packages Jun'2025
    {"page_id": "21f4a5e7-9e3c-80a3-af45-dd081f2e2768", "category": "Шаблоны"},           # SAMPLE_Counselor
]

MAX_DEPTH = 6
MAX_DB_ROWS = 300

_SKIP_DB_PROP_TYPES = {
    "relation", "rollup", "formula", "created_time", "created_by",
    "last_edited_time", "last_edited_by", "files", "button", "unique_id",
}


def _page_title(page: dict[str, Any]) -> str:
    for prop in (page.get("properties") or {}).values():
        if prop.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in prop.get("title", [])).strip()
    return ""


def _rich_text_html(rich_text: list[dict[str, Any]] | None) -> str:
    parts: list[str] = []
    for rt in rich_text or []:
        text = html.escape(rt.get("plain_text", "")).replace("\n", "<br/>")
        ann = rt.get("annotations") or {}
        if ann.get("code"):
            text = f"<code>{text}</code>"
        if ann.get("bold"):
            text = f"<strong>{text}</strong>"
        if ann.get("italic"):
            text = f"<em>{text}</em>"
        if ann.get("strikethrough"):
            text = f"<s>{text}</s>"
        if ann.get("underline"):
            text = f"<u>{text}</u>"
        href = rt.get("href")
        if href:
            if href.startswith("/"):
                href = "https://www.notion.so" + href  # internal mention links come through relative
            text = f'<a href="{html.escape(href)}" target="_blank" rel="noopener">{text}</a>'
        parts.append(text)
    return "".join(parts)


def _notion_link(target_id: str) -> str:
    return f"https://www.notion.so/{target_id.replace('-', '')}"


async def _list_block_children(client: NotionClient, block_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    params: dict[str, Any] = {"page_size": 100}
    while True:
        data = await client.request("GET", f"/blocks/{block_id}/children", params=params)
        out.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        params["start_cursor"] = data["next_cursor"]
    return out


def _render_table_block(rows: list[dict[str, Any]]) -> str:
    trs: list[str] = []
    for row in rows:
        if row.get("type") != "table_row":
            continue
        cells = row.get("table_row", {}).get("cells", [])
        tds = "".join(f"<td>{_rich_text_html(cell)}</td>" for cell in cells)
        trs.append(f"<tr>{tds}</tr>")
    return f"<table>{''.join(trs)}</table>" if trs else ""


def _cell_value(page_props: dict[str, Any], col: str) -> str | None:
    raw = page_props.get(col)
    value = flatten_property(raw) if raw else None
    if isinstance(value, bool):
        value = "Да" if value else "Нет"
    elif isinstance(value, list):
        value = ", ".join(str(v) for v in value)
    if value in (None, ""):
        return None
    return str(value)


async def _render_child_database(client: NotionClient, db_id: str, fallback_title: str) -> str:
    """Render a linked database as collapsible cards, not a wide table.

    These databases (e.g. package/pricing tables) commonly have 10+ columns
    where most rows only fill a few — a <table> forces every row to the
    height of its tallest cell (e.g. a long country list), making the whole
    thing unreadable. One row per <details> keeps the summary scannable and
    puts the rest behind a click.
    """
    try:
        dbjson = await client.request("GET", f"/databases/{db_id}")
    except Exception:
        return (
            f'<p class="kb-note">[Таблица Notion недоступна — '
            f'<a href="{_notion_link(db_id)}" target="_blank" rel="noopener">открыть в Notion</a>]</p>'
        )
    title = _plain_title(dbjson.get("title")) or fallback_title or "Таблица"
    props = dbjson.get("properties") or {}
    columns = [name for name, meta in props.items() if meta.get("type") not in _SKIP_DB_PROP_TYPES]
    title_col = next((c for c in columns if props[c].get("type") == "title"), None)
    other_cols = [c for c in columns if c != title_col]
    if not columns:
        return f"<h4>{html.escape(title)}</h4>"

    rows = await client.query_database(db_id, page_size=100)
    if not rows:
        return f"<h4>{html.escape(title)}</h4><p><em>Пусто</em></p>"

    items_html: list[str] = []
    for page in rows[:MAX_DB_ROWS]:
        page_props = page.get("properties") or {}
        summary = (_cell_value(page_props, title_col) if title_col else None) or "Без названия"
        fields_html = "".join(
            f'<div class="kb-field"><span class="kb-field-label">{html.escape(col)}</span>'
            f'<span class="kb-field-value">{html.escape(value)}</span></div>'
            for col in other_cols
            if (value := _cell_value(page_props, col)) is not None
        )
        items_html.append(
            f'<details class="kb-row"><summary>{html.escape(summary)}</summary>'
            f'<div class="kb-fields">{fields_html}</div></details>'
        )

    note = ""
    if len(rows) > MAX_DB_ROWS:
        note = (
            f'<p class="kb-note">Показаны первые {MAX_DB_ROWS} из {len(rows)} строк. '
            f'<a href="{_notion_link(db_id)}" target="_blank" rel="noopener">Открыть полностью в Notion →</a></p>'
        )
    return f"<h4>{html.escape(title)}</h4><div class=\"kb-db-rows\">{''.join(items_html)}</div>{note}"


async def _render_blocks(client: NotionClient, blocks: list[dict[str, Any]], depth: int = 0) -> str:
    if depth > MAX_DEPTH:
        return ""
    parts: list[str] = []
    list_buffer: list[str] = []
    list_tag: str | None = None

    def flush_list() -> None:
        nonlocal list_buffer, list_tag
        if list_buffer and list_tag:
            parts.append(f"<{list_tag}>" + "".join(list_buffer) + f"</{list_tag}>")
        list_buffer = []
        list_tag = None

    for block in blocks:
        btype = block.get("type")
        node = block.get(btype, {}) if btype else {}
        children_html = ""
        if block.get("has_children") and btype not in {"child_database", "child_page"}:
            children_html = await _render_blocks(client, await _list_block_children(client, block["id"]), depth + 1)

        if btype in ("bulleted_list_item", "numbered_list_item"):
            tag = "ul" if btype == "bulleted_list_item" else "ol"
            if list_tag != tag:
                flush_list()
                list_tag = tag
            item_html = _rich_text_html(node.get("rich_text")) + children_html
            list_buffer.append(f"<li>{item_html}</li>")
            continue
        flush_list()

        if btype == "paragraph":
            text = _rich_text_html(node.get("rich_text"))
            if text.strip():
                parts.append(f"<p>{text}</p>")
            if children_html:
                parts.append(children_html)
        elif btype in ("heading_1", "heading_2", "heading_3"):
            tag = {"heading_1": "h2", "heading_2": "h3", "heading_3": "h4"}[btype]
            parts.append(f"<{tag}>{_rich_text_html(node.get('rich_text'))}</{tag}>")
        elif btype == "quote":
            parts.append(f"<blockquote>{_rich_text_html(node.get('rich_text'))}{children_html}</blockquote>")
        elif btype == "callout":
            emoji = (node.get("icon") or {}).get("emoji") or ""
            prefix = f"{emoji} " if emoji else ""
            parts.append(f'<div class="kb-callout">{prefix}{_rich_text_html(node.get("rich_text"))}{children_html}</div>')
        elif btype == "divider":
            parts.append("<hr/>")
        elif btype == "toggle":
            parts.append(f"<details><summary>{_rich_text_html(node.get('rich_text'))}</summary>{children_html}</details>")
        elif btype == "code":
            code_text = html.escape("".join(t.get("plain_text", "") for t in node.get("rich_text", [])))
            parts.append(f"<pre><code>{code_text}</code></pre>")
        elif btype in ("column_list", "column", "synced_block"):
            if children_html:
                parts.append(children_html)
        elif btype == "table":
            table_rows = await _list_block_children(client, block["id"]) if block.get("has_children") else []
            parts.append(_render_table_block(table_rows))
        elif btype == "child_database":
            parts.append(await _render_child_database(client, block["id"], node.get("title", "")))
        elif btype == "link_to_page":
            target = node.get("page_id") or node.get("database_id")
            if target:
                parts.append(f'<p><a href="{_notion_link(target)}" target="_blank" rel="noopener">Смотреть в Notion →</a></p>')
        elif btype in ("image", "video", "file", "pdf"):
            caption = _rich_text_html(node.get("caption"))
            note = f" — {caption}" if caption else ""
            parts.append(f'<p class="kb-note">[{btype} — смотрите оригинал в Notion]{note}</p>')
        elif btype in ("bookmark", "embed"):
            url = node.get("url")
            if url:
                parts.append(f'<p><a href="{html.escape(url)}" target="_blank" rel="noopener">{html.escape(url)}</a></p>')
        # other block types (breadcrumb, table_of_contents, unsupported) are skipped silently
    flush_list()
    return "\n".join(p for p in parts if p)


@dataclass
class ArticleResult:
    title: str
    page_id: str
    action: str


async def _upsert_article(db: AsyncSession, client: NotionClient, page_id: str, category: str) -> ArticleResult:
    page = await client.get_page(page_id)
    title = _page_title(page) or category
    body = await _render_blocks(client, await _list_block_children(client, page_id))

    res = await db.execute(select(KnowledgeArticle).where(KnowledgeArticle.source_notion_page_id == page_id))
    article = res.scalar_one_or_none()
    action = "updated" if article else "created"
    if article is None:
        article = KnowledgeArticle(source_notion_page_id=page_id)
        db.add(article)

    article.title = title
    article.category = category
    article.body_html = body
    article.source_notion_url = page.get("url")
    article.source_last_edited_at = _parse_dt(page.get("last_edited_time"))
    return ArticleResult(title=title, page_id=page_id, action=action)


async def run_import(on_event: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    if not settings.NOTION_API_KEY.strip():
        raise RuntimeError("NOTION_API_KEY не настроен")
    client = NotionClient(settings.NOTION_API_KEY)

    created = updated = failed = 0
    articles: list[dict[str, Any]] = []
    try:
        async with AsyncSessionLocal() as db:
            for idx, target in enumerate(TARGETS, start=1):
                try:
                    result = await _upsert_article(db, client, target["page_id"], target["category"])
                    created += int(result.action == "created")
                    updated += int(result.action == "updated")
                    articles.append({"title": result.title, "action": result.action, "page_id": result.page_id})
                    if on_event:
                        on_event({"message": f"[{idx}/{len(TARGETS)}] {result.action}: {result.title}"})
                except Exception as exc:
                    failed += 1
                    if on_event:
                        on_event({"message": f"[{idx}/{len(TARGETS)}] ошибка {target['page_id']}: {exc}"})
            await db.commit()
    finally:
        await client.aclose()
    return {"found": len(TARGETS), "created": created, "updated": updated, "failed": failed, "articles": articles}


if __name__ == "__main__":
    argparse.ArgumentParser().parse_args()
    outcome = asyncio.run(run_import(on_event=lambda e: print(e.get("message"))))
    print("DONE", outcome)
