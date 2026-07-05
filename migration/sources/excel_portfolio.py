"""Import NEW_портфолио_студенты_УП_финал.xlsx."""
from __future__ import annotations
import logging
from pathlib import Path

import pandas as pd

from migration.transformers.normalize import parse_focus_areas

logger = logging.getLogger(__name__)

COUNTRY_COLUMNS = ["Венгрия", "НУ", "Гонконг", "США", "Корея", "Китай*", "Китай", "Италия*", "Италия", "Германия", "Канада"]
COUNTRY_CLEAN = {
    "Китай*": "Китай",
    "Италия*": "Италия",
}


def load_students(filepath: str | Path | None = None, df: pd.DataFrame | None = None) -> list[dict]:
    if df is None:
        df = pd.read_excel(filepath, sheet_name="Студенты", dtype=str)
        df = df.fillna("")
    logger.info(f"Portfolio: loaded {len(df)} student rows")

    records = []
    for _, row in df.iterrows():
        full_name = str(row.get("ФИО студента", "") or "").strip()
        if not full_name:
            continue

        # Parse country columns
        countries = []
        for col in COUNTRY_COLUMNS:
            val = str(row.get(col, "") or "").strip()
            if val and val.lower() not in ("nan", "", "нет"):
                clean_country = COUNTRY_CLEAN.get(col, col)
                countries.append(clean_country)

        status_raw = str(row.get("Статус", "") or "").strip().lower()
        status = "not_started"
        if "в работе" in status_raw or "in_progress" in status_raw:
            status = "in_progress"
        elif "завершено" in status_raw or "completed" in status_raw:
            status = "completed"

        records.append({
            "source": "excel_portfolio",
            "full_name": full_name,
            "group_direction": str(row.get("Группа / Направление", "") or "").strip() or None,
            "additional_sphere": str(row.get("Доп. сфера", "") or "").strip() or None,
            "specialty": str(row.get("Специальность", "") or "").strip() or None,
            "city": str(row.get("Город", "") or "").strip() or None,
            "portfolio": {
                "special_notes": str(row.get("Особенности / заметки", "") or "").strip() or None,
                "first_call_milestone": str(row.get("Первый созвон", "") or "").strip() or None,
                "deadline_text": str(row.get("Дедлайн", "") or "").strip() or None,
                "focus_areas": parse_focus_areas(str(row.get("Упор", "") or "")),
                "status": status,
                "achievements_count": _to_int(row.get("Грамот получено", "")) or 0,
                "calls_count": _to_int(row.get("Созвонов проведено", "")) or 0,
                "vpp_group": str(row.get("Группа ВПП", "") or "").strip() or None,
            },
            "countries": countries,
        })

    return records


def load_country_reference(filepath: str | Path | None = None, df: pd.DataFrame | None = None) -> list[dict]:
    if df is None:
        try:
            df = pd.read_excel(filepath, sheet_name="📌 Справочник стран", dtype=str)
        except Exception:
            try:
                df = pd.read_excel(filepath, sheet_name="Справочник стран", dtype=str)
            except Exception:
                logger.warning("Country reference sheet not found in portfolio file")
                return []
    df = df.fillna("")
    records = []
    for _, row in df.iterrows():
        name = str(row.get("Страна", "") or "").strip()
        if not name:
            continue
        vpp_raw = str(row.get("УП нужно?", "") or "").strip()
        records.append({
            "country_name": name,
            "vpp_required": "✅" in vpp_raw or "нужно" in vpp_raw.lower(),
            "submission_deadline_notes": str(row.get("Дедлайн подач", "") or "").strip() or None,
            "notes": str(row.get("Примечания", "") or "").strip() or None,
        })
    return records


def _to_int(val) -> int | None:
    try:
        return int(float(str(val)))
    except (ValueError, TypeError):
        return None
