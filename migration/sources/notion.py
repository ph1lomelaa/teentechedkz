"""Чтение Notion-базы «Весь пайплайн клиентов» (read-only).

Схема живой базы (июль 2026): title-колонка без имени, деньги частично number,
частично formula, названия колонок с хвостовыми пробелами. Поэтому:
- значение каждого свойства достаётся по его РЕАЛЬНОМУ типу из API, а не по
  ожидаемому — переключение select→multi_select или formula→number в Notion
  не ломает чтение;
- поиск колонок идёт по имени со strip() и без учёта регистра;
- ФИО берётся из любого свойства типа title, как бы оно ни называлось.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

import requests

logger = logging.getLogger(__name__)

NOTION_VERSION = "2022-06-28"


def _headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }


def flatten_property(prop: dict) -> Any:
    """Значение свойства Notion по его фактическому типу → плоское py-значение."""
    ptype = prop.get("type")
    value = prop.get(ptype)
    if value is None:
        return None
    try:
        if ptype in ("title", "rich_text"):
            return "".join(t.get("plain_text", "") for t in value) or None
        if ptype in ("select", "status"):
            return value.get("name")
        if ptype == "multi_select":
            return [ms.get("name") for ms in value if ms.get("name")]
        if ptype in ("number", "phone_number", "url", "email", "checkbox"):
            return value
        if ptype == "date":
            return value.get("start")
        if ptype == "formula":
            ftype = value.get("type")
            inner = value.get(ftype)
            if ftype == "date" and isinstance(inner, dict):
                return inner.get("start")
            return inner
        if ptype == "people":
            return [p.get("name") for p in value if p.get("name")]
        if ptype == "relation":
            return [r.get("id") for r in value]
        if ptype == "rollup":
            return value.get(value.get("type"))
    except (KeyError, TypeError, AttributeError):
        return None
    return None


def flatten_properties(props: dict) -> dict[str, Any]:
    """Все свойства страницы → {имя_колонки: плоское значение}."""
    flat: dict[str, Any] = {}
    for name, prop in props.items():
        flat[name] = flatten_property(prop)
    return flat


def fetch_all_pages(api_key: str | None = None, database_id: str | None = None) -> list[dict]:
    """Все страницы базы с пагинацией. Бросает RuntimeError при ошибке API."""
    api_key = api_key or os.getenv("NOTION_API_KEY", "")
    database_id = database_id or os.getenv("NOTION_DATABASE_ID", "")
    if not api_key or not database_id:
        raise RuntimeError("NOTION_API_KEY / NOTION_DATABASE_ID не заданы в .env")

    records: list[dict] = []
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    payload: dict = {"page_size": 100}

    while True:
        resp = requests.post(url, headers=_headers(api_key), json=payload, timeout=30)
        if resp.status_code != 200:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise RuntimeError(f"Notion API {resp.status_code}: {detail}")
        data = resp.json()
        records.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        payload["start_cursor"] = data["next_cursor"]

    logger.info(f"Fetched {len(records)} records from Notion")
    return records


def strip_flag(label: Any) -> str:
    """'🇺🇸 USA' → 'USA' (метки стран в Notion начинаются с эмодзи-флага)."""
    parts = str(label or "").strip().split(" ", 1)
    if len(parts) == 2 and not parts[0].isascii():
        return parts[1].strip()
    return str(label or "").strip()


def _countries(value: Any) -> list[str]:
    raw = value if isinstance(value, list) else ([value] if value else [])
    # В Notion среди опций встречаются заглушки «none»/«нет» — это не страны
    return [c for c in (strip_flag(v) for v in raw) if c and c.lower() not in ("none", "no", "-", "нет")]


def clean_phone(value: Any) -> str:
    """Телефоны в Notion бывают с приписками ('77710234525мама') — оставляем цифры.
    8XXX → 7XXX; если цифр больше 11 (в ячейке два номера), берём первый."""
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return ""
    if digits.startswith("8") and len(digits) >= 11:
        digits = "7" + digits[1:]
    if len(digits) > 11 and digits.startswith("7"):
        digits = digits[:11]
    return digits


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


class _Flat:
    """Доступ к flatten-значениям по имени: strip + без учёта регистра."""

    def __init__(self, flat: dict[str, Any]):
        self._by_key = {name.strip().lower(): v for name, v in flat.items()}

    def get(self, *names: str) -> Any:
        for name in names:
            v = self._by_key.get(name.strip().lower())
            if v not in (None, "", []):
                return v
        return None


def _title_of(props: dict) -> str:
    for name, prop in props.items():
        if prop.get("type") == "title":
            return str(flatten_property(prop) or "").strip()
    return ""


def transform_notion_records(records: list[dict]) -> list[dict]:
    """Страницы Notion → нормализованные строки + плоский снапшот всех колонок."""
    rows: list[dict] = []
    for page in records:
        props = page.get("properties", {})
        flat = flatten_properties(props)
        f = _Flat(flat)

        row = {
            "notion_page_id": page["id"],
            "notion_url": page.get("url"),
            "last_edited_time": page.get("last_edited_time"),
            "raw_properties": flat,
            "full_name": _title_of(props),
            "phone": clean_phone(f.get("Номер тел")),
            "degree_raw": f.get("Degree"),
            "intake_raw": f.get("Intake"),
            "payment_status_raw": f.get("Статус выплат"),
            "date_of_agreement": f.get("Date of Agreement"),
            "client_fee": f.get("Client fee"),
            "mentor_total": f.get("TOTAL (Mentors)"),
            "mentor_paid": f.get("PAID (Mentors)"),
            "mentor_tbp": f.get("TBP (Mentors)"),
            "english_sum": f.get("Сумм Англ"),
            "english_paid": f.get("PAID Англ", "PAID англ"),
            "english_tbp": f.get("TBP Англ"),
            "up_sum": f.get("Сумм УП"),
            "up_paid": f.get("PAID УП"),
            "up_tbp": f.get("TBP УП"),
            "up_activities": _as_list(f.get("УП активности")),
            "proforientation_sum": f.get("Сумм Профориентация"),
            "ielts_exam_fee": f.get("IELTS exam fee"),
            "client_remaining": f.get("Остаток клиента"),
            "client_remaining_date": f.get("Остаток клиента (дата)", "Остаток клиент..."),
            "total_company": f.get("TOTAL (Company)"),
            "cost_percent": f.get("Себес"),
            "days_in_work": f.get("d в работе"),
            "lead_mentor": f.get("Lead-Mentor"),
            "mentors": _as_list(f.get("Mentors")),
            "mzk": f.get("МЗК"),
            "main_countries": _countries(f.get("Main country")),
            "other_countries": _countries(f.get("Other countries")),
        }
        if row["full_name"]:
            rows.append(row)

    return rows
