"""Import Кейсы_студентов.xlsx — primary student survey."""
from __future__ import annotations
import logging
import re
from pathlib import Path

import pandas as pd

from migration.transformers.normalize import normalize_phone, parse_degree

logger = logging.getLogger(__name__)


def load(filepath: str | Path | None = None, df: pd.DataFrame | None = None) -> list[dict]:
    if df is None:
        df = pd.read_excel(filepath, sheet_name="Form Responses 1", dtype=str)
        df = df.fillna("")
    logger.info(f"Loaded {len(df)} rows from Кейсы_студентов source")

    # Deduplicate: keep latest by Timestamp per phone
    if "Timestamp" in df.columns:
        df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
        df = df.sort_values("Timestamp", ascending=False).drop_duplicates(
            subset=["Ваш Номер телефона (WhatsApp)"], keep="first"
        )

    records = []
    for _, row in df.iterrows():
        phone = normalize_phone(row.get("Ваш Номер телефона (WhatsApp)", ""))
        full_name = str(row.get("ФИО студента ", "") or row.get("ФИО студента", "")).strip()
        if not full_name:
            continue

        ielts_raw = str(row.get("Имеется ли IELTS\\TOEFL? Если нет, то какой уровень английского?", "") or "")
        ielts_score = None
        ielts_status = "not_started"
        score_match = re.search(r"\b([5-9]\.\d)\b", ielts_raw)
        if score_match:
            ielts_score = score_match.group(1)
            ielts_status = "completed"

        sat_raw = str(row.get("Имеется ли SAT\\Gmat\\Gre?", "") or "")
        sat_included = sat_raw.strip().lower() not in ("", "нет", "nan", "no")

        special_agreement = str(row.get("Есть ли особые договоренности с менеджером...?", "") or "").strip()
        conf_note = special_agreement if special_agreement.lower() not in ("нет", "", "nan", "no") else None

        records.append({
            "source": "excel_cases",
            "full_name": full_name,
            "phone": phone,
            "age": _to_int(row.get("Возраст ", "") or row.get("Возраст", "")),
            "city": str(row.get("С какого Вы города? ", "") or "").strip() or None,
            "degree_level": parse_degree(str(row.get("Рассматриваете бакалавриат\\магистратуру?", "") or "")),
            "specialty": str(row.get("Какую специальность выбираете? ", "") or "").strip() or None,
            "budget_per_year": str(row.get("Какой у Вас бюджет на обучение? ", "") or "").strip() or None,
            "intake_year": _to_int(row.get("Год поступления?", "")),
            "gpa": str(row.get("Какой у Вас средний балл оценок (GPA)?", "") or "").strip() or None,
            "achievements_text": str(row.get("Какие внешкольные достижения имеются?\\Какой опыт работы?", "") or "").strip() or None,
            "transcript_resume_url": str(row.get("Можете прикрепить транскрипт и резюме ", "") or "").strip() or None,
            "mzk_name": str(row.get("Имя Вашего менеджера? ", "") or "").strip() or None,
            "country": str(row.get("Страна поступления", "") or "").strip() or None,
            "ielts_score": ielts_score,
            "ielts_status": ielts_status,
            "ielts_raw": ielts_raw,
            "sat_included": sat_included,
            "confidential_note": conf_note,
        })

    return records


def _to_int(val) -> int | None:
    try:
        return int(float(str(val)))
    except (ValueError, TypeError):
        return None
