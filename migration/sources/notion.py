"""Import from Notion 'Весь пайплайн клиентов' database."""
from __future__ import annotations
import logging
import os
from typing import Any

import requests

logger = logging.getLogger(__name__)

NOTION_API_KEY = os.getenv("NOTION_API_KEY", "")
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID", "")
NOTION_VERSION = "2022-06-28"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {NOTION_API_KEY}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def _get_prop(props: dict, name: str, prop_type: str, default=None):
    prop = props.get(name)
    if not prop:
        return default
    try:
        if prop_type == "title":
            return "".join(t["plain_text"] for t in prop.get("title", []))
        elif prop_type == "rich_text":
            return "".join(t["plain_text"] for t in prop.get("rich_text", []))
        elif prop_type == "phone_number":
            return prop.get("phone_number")
        elif prop_type == "select":
            sel = prop.get("select")
            return sel["name"] if sel else None
        elif prop_type == "multi_select":
            return [ms["name"] for ms in prop.get("multi_select", [])]
        elif prop_type == "number":
            return prop.get("number")
        elif prop_type == "formula":
            formula = prop.get("formula", {})
            return formula.get("number") or formula.get("string")
        elif prop_type == "date":
            d = prop.get("date")
            return d["start"] if d else None
    except (KeyError, TypeError):
        return default
    return default


def fetch_all_pages() -> list[dict[str, Any]]:
    """Fetch all pages from Notion database with pagination."""
    if not NOTION_API_KEY or not NOTION_DATABASE_ID:
        logger.warning("Notion credentials not configured. Skipping.")
        return []

    records = []
    url = f"https://api.notion.com/v1/databases/{NOTION_DATABASE_ID}/query"
    payload: dict = {"page_size": 100}

    while True:
        resp = requests.post(url, headers=_headers(), json=payload, timeout=30)
        if resp.status_code != 200:
            logger.error(f"Notion API error: {resp.status_code} {resp.text}")
            break
        data = resp.json()
        records.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]

    logger.info(f"Fetched {len(records)} records from Notion")
    return records


def transform_notion_records(records: list[dict]) -> list[dict]:
    """Transform Notion API records into intermediate format."""
    result = []
    for page in records:
        props = page.get("properties", {})
        row = {
            "source": "notion",
            "notion_page_id": page["id"],
            "full_name": (_get_prop(props, "Name", "title") or "").strip(),
            "phone": (_get_prop(props, "Номер тел", "phone_number") or "").replace(" ", ""),
            "degree_level_raw": _get_prop(props, "Degree", "select"),
            "intake_year_raw": _get_prop(props, "Intake", "select"),
            "pipeline_status_raw": _get_prop(props, "Статус выплат", "select"),
            "signed_date": _get_prop(props, "Date of Agreement", "date"),
            "amount": _get_prop(props, "Client fee", "number"),
            "mentor_total_owed": _get_prop(props, "TOTAL (Mentors)", "formula"),
            "mentor_paid": _get_prop(props, "PAID (Mentors)", "number"),
            "mentor_tbp": _get_prop(props, "TBP (Mentors)", "formula"),
            "english_sum": _get_prop(props, "Сумм Англ", "number"),
            "english_paid": _get_prop(props, "PAID Англ", "number"),
            "client_remaining_amount": _get_prop(props, "Остаток клиента", "formula"),
            "client_remaining_date": _get_prop(props, "Остаток клиент...", "date"),
            "lead_mentor_name": _get_prop(props, "Lead-Mentor", "select"),
            "mentor_names": _get_prop(props, "Mentors", "multi_select") or [],
            "mzk_name": _get_prop(props, "МЗК", "select"),
            "main_country": _get_prop(props, "Main country", "select"),
            "other_countries": _get_prop(props, "Other countries", "multi_select") or [],
        }
        if row["full_name"]:
            result.append(row)

    return result
