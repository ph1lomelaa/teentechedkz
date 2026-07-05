from __future__ import annotations

import json
import re
from typing import Any

from app.models.student import Student, DegreeLevel, IntakeSeason


NOTEABLE_FIELDS = (
    "full_name",
    "phone",
    "city",
    "age",
    "degree_level",
    "specialty",
    "group_direction",
    "additional_sphere",
    "gpa",
    "achievements_text",
    "budget_per_year",
    "transcript_resume_url",
    "intake_year",
    "intake_season",
)


def snapshot_student(student: Student) -> dict[str, Any]:
    return {
        "full_name": student.full_name,
        "phone": student.phone,
        "city": student.city,
        "age": student.age,
        "degree_level": student.degree_level.value if student.degree_level else None,
        "specialty": student.specialty,
        "group_direction": student.group_direction,
        "additional_sphere": student.additional_sphere,
        "gpa": student.gpa,
        "achievements_text": student.achievements_text,
        "budget_per_year": student.budget_per_year,
        "transcript_resume_url": student.transcript_resume_url,
        "intake_year": student.intake_year,
        "intake_season": student.intake_season.value if student.intake_season else None,
    }


def parse_suggested_changes(raw: dict[str, Any] | None, source_text: str) -> dict[str, Any]:
    parsed = dict(raw or {})
    if parsed:
        return parsed

    parsed.update(_extract_from_text(source_text))
    return parsed


FIELD_LABELS_RU: dict[str, str] = {
    "full_name": "ФИО",
    "phone": "Телефон",
    "city": "Город",
    "age": "Возраст",
    "degree_level": "Ступень",
    "specialty": "Специальность",
    "group_direction": "Направление",
    "additional_sphere": "Доп. сфера",
    "gpa": "GPA",
    "achievements_text": "Достижения",
    "budget_per_year": "Бюджет в год",
    "transcript_resume_url": "Транскрипт/резюме",
    "intake_year": "Год поступления",
    "intake_season": "Сезон поступления",
}

_VALUE_LABELS_RU: dict[str, str] = {
    "undergraduate": "Бакалавриат",
    "masters": "Магистратура",
    "foundation": "Foundation",
    "found_ug": "Foundation + Бакалавриат",
    "fall": "Осень",
    "spring": "Весна",
}


def humanize_field(field: str) -> str:
    return FIELD_LABELS_RU.get(field, field)


def humanize_value(value: Any) -> str:
    if value in (None, "", []):
        return "—"
    return _VALUE_LABELS_RU.get(str(value), str(value))


def build_summary_markdown(title: str, source_text: str, snapshot: dict[str, Any], suggested_changes: dict[str, Any]) -> str:
    """Конспект для менеджера: суть разговора + изменения «было → станет».
    Профиль студента не дублируем — он и так открыт рядом в карточке."""
    chunks: list[str] = [f"## {title.strip() or 'Конспект'}"]

    body_lines = [line.strip(" -•\t") for line in source_text.splitlines() if line.strip()]
    if body_lines:
        chunks.append("")
        for line in body_lines[:12]:
            chunks.append(f"- {line}")

    chunks.append("")
    chunks.append("**Предлагаемые изменения**")
    if suggested_changes:
        for key, value in suggested_changes.items():
            old = humanize_value(snapshot.get(key))
            new = humanize_value(value)
            chunks.append(f"- {humanize_field(key)}: {old} → **{new}**")
    else:
        chunks.append("- Изменений не обнаружено")

    return "\n".join(chunks)


def coerce_student_value(field: str, value: Any) -> Any:
    if field in {"age", "intake_year"}:
        if value in (None, ""):
            return None
        return int(value)
    if field == "degree_level":
        if value in (None, ""):
            return None
        return DegreeLevel(str(value))
    if field == "intake_season":
        if value in (None, ""):
            return None
        return IntakeSeason(str(value))
    return None if value == "" else value


def build_profile_diff(snapshot: dict[str, Any], suggested_changes: dict[str, Any]) -> list[dict[str, Any]]:
    diff: list[dict[str, Any]] = []
    for field, raw_new in suggested_changes.items():
        if field not in NOTEABLE_FIELDS:
            continue
        old_value = snapshot.get(field)
        new_value = raw_new
        if old_value != new_value:
            diff.append({"field": field, "old_value": old_value, "new_value": new_value})
    return diff


def apply_student_updates(student: Student, suggested_changes: dict[str, Any]) -> list[dict[str, Any]]:
    applied: list[dict[str, Any]] = []
    for field, raw_new in suggested_changes.items():
        if field not in NOTEABLE_FIELDS:
            continue
        new_value = coerce_student_value(field, raw_new)
        old_value = getattr(student, field)
        if old_value != new_value:
            setattr(student, field, new_value)
            applied.append({"field": field, "old_value": old_value, "new_value": new_value})
    return applied


def _extract_from_text(text: str) -> dict[str, Any]:
    extracted: dict[str, Any] = {}

    gpa_match = re.search(r"(?:gpa|гпа|средний балл)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)", text, re.IGNORECASE)
    if gpa_match:
        extracted["gpa"] = gpa_match.group(1).replace(",", ".")

    budget_match = re.search(r"(?:бюджет(?:\s*в\s*год)?|budget)\s*[:=]?\s*([0-9][0-9\s.,]*)", text, re.IGNORECASE)
    if budget_match:
        extracted["budget_per_year"] = budget_match.group(1).strip()

    city_match = re.search(r"(?:город|city)\s*[:=]?\s*([A-Za-zА-Яа-яЁё'\-\s]{2,})", text, re.IGNORECASE)
    if city_match:
        extracted["city"] = city_match.group(1).strip()

    specialty_match = re.search(r"(?:специальност[ьи]|major|program)\s*[:=]?\s*([A-Za-zА-Яа-яЁё0-9'’\-\s]{2,})", text, re.IGNORECASE)
    if specialty_match:
        extracted["specialty"] = specialty_match.group(1).strip()

    year_match = re.search(r"\b(20[2-9]\d)\b", text)
    if year_match:
        extracted["intake_year"] = int(year_match.group(1))

    if re.search(r"\bfoundation\b", text, re.IGNORECASE):
        extracted["degree_level"] = "foundation"
    elif re.search(r"\bmasters?\b|\bмагистр\b", text, re.IGNORECASE):
        extracted["degree_level"] = "masters"
    elif re.search(r"\bbachelor\b|\bбакалавр\b", text, re.IGNORECASE):
        extracted["degree_level"] = "undergraduate"

    if re.search(r"\bfall\b|\bосен", text, re.IGNORECASE):
        extracted["intake_season"] = "fall"
    elif re.search(r"\bspring\b|\bвесн", text, re.IGNORECASE):
        extracted["intake_season"] = "spring"

    if re.search(r"\bдостиж|\bolympiad|\bproject\b|\bволонт", text, re.IGNORECASE):
        extracted["achievements_text"] = _shorten(text, 240)

    return extracted


def _shorten(text: str, limit: int) -> str:
    compact = " ".join(text.split())
    return compact[:limit]


def render_change_preview(snapshot: dict[str, Any], suggested_changes: dict[str, Any]) -> list[dict[str, Any]]:
    preview: list[dict[str, Any]] = []
    for field, raw_new in suggested_changes.items():
        if field not in NOTEABLE_FIELDS:
            continue
        preview.append(
            {
                "field": field,
                "old_value": snapshot.get(field),
                "new_value": raw_new,
            }
        )
    return preview
