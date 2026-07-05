"""Import МЗК_таблица.xlsx — 11 sheets."""
from __future__ import annotations
import logging
import re
from pathlib import Path
from typing import Any

import pandas as pd

from migration.transformers.normalize import (
    normalize_phone, normalize_amount, parse_service_status, parse_countries_with_counts
)

logger = logging.getLogger(__name__)

# Активные листы → имя МЗК-менеджера
ACTIVE_SHEETS: dict[str, str] = {
    "Аружан таблица": "Аружан",
    "Зере таблица ": "Зере",    # с пробелом в конце
    "Зере": "Зере",
    "студенты": "Зере",         # США 2027 — заголовки в строке 2
    "Амина новая таб": "Амина",
    "Студенты 2027 Амина": "Амина",
    "статусы по студентам": "__tasks__",
}

ARCHIVED_SHEETS: set[str] = {
    "Зере таблица  (копия)",
    "Зере таблица 1",
    "Амина старая таблица",
    "Лейла старая таблица",
}


def load(filepath: str | Path | None = None, sheets: dict[str, pd.DataFrame] | None = None) -> dict[str, Any]:
    """Returns {'students': [...], 'tasks': [...], 'archived': [...]}.

    Pass filepath for Excel, or sheets={name: DataFrame} for Google Sheets.
    """
    if sheets is None:
        xl = pd.ExcelFile(filepath)
        sheet_names = xl.sheet_names
        sheets = {}
        for name in sheet_names:
            # Зере USA sheet has headers on row 2 — keep raw for special handling
            sheets[name] = xl.parse(name, dtype=str).fillna("")
        # Re-parse the special sheet with header=1
        if "студенты" in sheets:
            sheets["студенты"] = xl.parse("студенты", header=1, dtype=str).fillna("")
    else:
        xl = None

    sheet_names = list(sheets.keys())
    logger.info(f"МЗК sheets: {sheet_names}")

    all_students: list[dict] = []
    all_tasks: list[dict] = []
    archived: list[str] = []

    for sheet in sheet_names:
        if sheet in ARCHIVED_SHEETS:
            archived.append(sheet)
            logger.info(f"Archive (skip): {sheet}")
            continue

        mzk_name = ACTIVE_SHEETS.get(sheet)
        if mzk_name is None:
            logger.info(f"Unknown sheet, skip: {sheet!r}")
            continue

        try:
            df = sheets[sheet]
            if mzk_name == "__tasks__":
                tasks = _load_tasks_sheet(df, sheet)
                all_tasks.extend(tasks)
                logger.info(f"Tasks sheet {sheet!r}: {len(tasks)} rows")
            elif sheet == "студенты":
                records = _load_zere_usa_sheet(df, sheet, mzk_name)
                all_students.extend(records)
                logger.info(f"USA-2027 sheet {sheet!r}: {len(records)} records")
            else:
                records = _load_standard_sheet(df, sheet, mzk_name)
                all_students.extend(records)
                logger.info(f"Standard sheet {sheet!r}: {len(records)} records")
        except Exception as e:
            logger.error(f"Error loading sheet {sheet!r}: {e}")

    return {"students": all_students, "tasks": all_tasks, "archived": archived}


def _load_standard_sheet(df: pd.DataFrame, sheet: str, mzk_name: str) -> list[dict]:

    # Определяем фактический столбец имени студента (первые два варианта)
    name_col = next((c for c in df.columns if "студент" in c.lower() or c.strip() == "Имя студента"), None)
    if not name_col:
        logger.warning(f"Sheet {sheet!r}: column 'Имя студента' not found, cols={df.columns.tolist()}")
        return []

    records = []
    for _, row in df.iterrows():
        name = str(row.get(name_col, "") or "").strip()
        if not name or name.lower() in ("nan", "имя", "студент", "№", ""):
            continue

        phone = normalize_phone(str(row.get("Номер телефона", "") or ""))

        # Услуги — перебираем возможные варианты написания колонок
        services = {}
        svc_col_variants = {
            "proforientation": ["Профориентация", "профориентация"],
            "ielts_mock":      ["Мок тест по айлтс", "Мок тест", "Мок", "мок"],
            "ielts_prep":      ["Подготовка к айлтс", "Подготовка к IELTS", "IELTS подготовка"],
            "sat_prep":        ["Подготовка SAT", "Подготовка к SAT", "SAT подготовка", "сат"],
            "portfolio_improvement": ["Улучшение портфолио", "портфолио", "Портфолио"],
        }
        for svc_type, col_names in svc_col_variants.items():
            for col in col_names:
                if col in df.columns:
                    val = str(row.get(col, "") or "")
                    status, result = parse_service_status(val)
                    services[svc_type] = {"status": status, "result": result}
                    break

        # Страны
        direction_raw = str(row.get("Направление", "") or "")
        countries = parse_countries_with_counts(direction_raw) if direction_raw else []

        # Ментор
        mentor_raw = str(row.get("Ментор", "") or "").strip()

        # Сумма — пробуем несколько вариантов колонки
        amount_raw = (
            str(row.get("Стоимость", "") or "")
            or str(row.get("client fee", "") or "")
            or str(row.get("Сумма договора", "") or "")
        )
        amount = normalize_amount(amount_raw)

        # Задачи (разделитель — перенос строки или точка с запятой)
        tasks_raw = str(row.get("задачи ", "") or row.get("задачи", "") or "").strip()
        tasks = [
            t.strip() for t in re.split(r"[;\n]", tasks_raw)
            if t.strip() and t.strip().lower() not in ("nan", "")
        ]

        # Договорённости/заметки
        notes_parts = []
        for col in ("Договоренности", "Статус", "Unnamed: 11", "comments Aru"):
            val = str(row.get(col, "") or "").strip()
            if val and val.lower() not in ("nan", "", "нет"):
                notes_parts.append(val)
        notes = " | ".join(notes_parts) if notes_parts else None

        # Дата договора
        signed_date_raw = str(row.get("Дата заключение договора", "") or "").strip() or None
        if signed_date_raw and signed_date_raw.lower() in ("nan", ""):
            signed_date_raw = None

        ielts_payment = str(row.get("оплата айлтс", "") or "").strip().lower()

        records.append({
            "source": "excel_mzk",
            "mzk_sheet": sheet,
            "mzk_name": mzk_name,
            "full_name": name,
            "phone": phone,
            "services": services,
            "countries": countries,
            "mentor_raw": mentor_raw,
            "amount": amount,
            "tasks": tasks,
            "notes": notes,
            "ielts_payment_included": ielts_payment in ("ок", "ok", "да", "yes", "+"),
            "signed_date_raw": signed_date_raw,
        })

    return records


def _load_zere_usa_sheet(df: pd.DataFrame, sheet: str, mzk_name: str) -> list[dict]:
    """Лист 'студенты' — заголовки в строке 2 (DataFrame уже с правильным header)."""

    records = []
    for _, row in df.iterrows():
        name = str(row.get("ФИО", "") or "").strip()
        if not name or name.lower() in ("nan", "фио", ""):
            continue

        phone = normalize_phone(str(row.get("номер телефона", "") or ""))

        # Результат профориентации
        prof_result = str(row.get("результаты профориентации", "") or "").strip()
        prof_status = "completed" if prof_result and prof_result.lower() != "nan" else "not_started"

        # SAT / IELTS из колонок
        sat_status, _ = parse_service_status(str(row.get("САТ", "") or ""))
        ielts_status, ielts_result = parse_service_status(str(row.get("АЙЕЛТС", "") or ""))

        tasks = []
        report = str(row.get("Отчет", "") or "").strip()
        if report and report.lower() != "nan":
            tasks.append(report)

        records.append({
            "source": "excel_mzk",
            "mzk_sheet": sheet,
            "mzk_name": mzk_name,
            "full_name": name,
            "phone": phone,
            "services": {
                "sat_prep": {"status": sat_status, "result": None},
                "ielts_mock": {"status": ielts_status, "result": ielts_result},
                "proforientation": {"status": prof_status, "result": prof_result or None},
            },
            "countries": [("США", 1)],
            "mentor_raw": str(row.get("Ментор", "") or "").strip(),
            "amount": None,
            "tasks": tasks,
            "notes": None,
            "ielts_payment_included": False,
            "signed_date_raw": None,
        })

    return records


def _load_tasks_sheet(df: pd.DataFrame, sheet: str) -> list[dict]:
    """Лист 'статусы по студентам' — 210 строк статусов."""

    tasks = []
    for _, row in df.iterrows():
        name = str(
            row.get("Имя студента", "")
            or row.get("ФИО", "")
            or row.get("Студент", "")
            or ""
        ).strip()

        # Колонка называется "Cтатус по студенту" (с кириллической С в начале)
        status_raw = str(
            row.get("Cтатус по студенту", "")
            or row.get("Статус", "")
            or row.get("статус", "")
            or ""
        ).strip()

        if not name or name.lower() in ("nan", ""):
            continue
        if not status_raw or status_raw.lower() in ("nan", ""):
            continue

        tasks.append({
            "full_name": name,
            "task_text": status_raw[:1000],
        })

    return tasks
