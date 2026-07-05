"""Import Пакет_сопровождения.xlsx — contract + services data."""
from __future__ import annotations
import logging
import re
from pathlib import Path

import pandas as pd

from migration.transformers.normalize import (
    normalize_phone, normalize_amount, parse_degree, parse_countries_with_counts
)

logger = logging.getLogger(__name__)


def load(filepath: str | Path | None = None, df: pd.DataFrame | None = None) -> list[dict]:
    if df is None:
        df = pd.read_excel(filepath, sheet_name="Form Responses 1", dtype=str)
        df = df.fillna("")
    logger.info(f"Loaded {len(df)} rows from Пакет_сопровождения source")

    records = []
    for _, row in df.iterrows():
        phone = normalize_phone(row.get("Номер телефона студента", ""))
        full_name = str(row.get("ФИО студента ", "") or row.get("ФИО студента", "")).strip()
        if not full_name:
            continue

        countries_raw = str(row.get("Cтраны поступления по Договору?", "") or "")
        countries = parse_countries_with_counts(countries_raw)

        portfolio_raw = str(row.get("По улучшению портфолио сколько направлении купил?", "") or "").strip().lower()
        portfolio_count = None
        portfolio_included = False
        if portfolio_raw not in ("", "нет", "nan", "не купила", "не покупал"):
            portfolio_included = True
            if portfolio_raw in ("все", "all"):
                portfolio_count = 4
            else:
                m = re.search(r"\d+", portfolio_raw)
                if m:
                    portfolio_count = int(m.group())
                else:
                    portfolio_count = 1

        conf_note = str(row.get("Есть ли личные договорённости...?", "") or "").strip()
        if conf_note.lower() in ("нет", "", "nan", "no"):
            conf_note = None

        records.append({
            "source": "excel_package",
            "full_name": full_name,
            "phone": phone,
            "intake_year": _to_int(row.get("Год поступления? ", "")),
            "degree_level": parse_degree(str(row.get("Студент поступает на бакалавриат\\магистратуру? ", "") or "")),
            "amount": normalize_amount(row.get("Какая стоимость сопровождения? ", "")),
            "mzk_name": str(row.get("Имя менеджера ", "") or "").strip() or None,
            "proforientation_included": _yes_no(row.get("Услуга профориентация есть?", "")),
            "ielts_mock_included": _yes_no(row.get("Мок тест по айлтс есть? ", "")),
            "ielts_prep_included": _yes_no(row.get("IELTS подготовка есть?", "")),
            "sat_prep_included": _yes_no(row.get("САТ подготовка есть? ", "")),
            "portfolio_included": portfolio_included,
            "portfolio_count": portfolio_count,
            "countries": countries,  # list of (country_name, submissions_planned)
            "confidential_note": conf_note,
        })

    return records


def _to_int(val) -> int | None:
    try:
        return int(float(str(val)))
    except (ValueError, TypeError):
        return None


def _yes_no(val: str) -> bool:
    return str(val).strip().lower() in ("да", "yes", "1", "true", "+")
