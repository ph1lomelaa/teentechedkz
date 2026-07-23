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

SPECULATIVE_FIELD_NOTE_KEY = "context_note"
SPECULATIVE_PROFILE_FIELDS = {"intake_year", "intake_season"}
_SPECULATIVE_RE = re.compile(
    r"\b("
    r"думаю|планирую|хочу|рассматриваю|возможно|наверн\w*|скорее|может|собираюсь|"
    r"considering|thinking|maybe|probably|closer"
    r")\b|\bближе\b",
    re.IGNORECASE,
)
_IELTS_ZERO_RE = re.compile(
    r"(?:ielts|айл[тт]с).{0,40}(?:до|на|=|:)?\s*(?:0|н[уо]л[ьяею]?)\b|"
    r"(?:до|на|=|:)?\s*(?:0|н[уо]л[ьяею]?)\b.{0,40}(?:ielts|айл[тт]с)",
    re.IGNORECASE,
)


def detect_quality_warnings(text: str) -> list[str]:
    compact = " ".join((text or "").split())
    warnings: list[str] = []
    if compact and _IELTS_ZERO_RE.search(compact):
        warnings.append("Есть нелогичное упоминание IELTS около значения 0; не сохранять как подтверждённый результат без проверки.")
    return warnings


def remove_quality_risky_notes(notes: list[str]) -> tuple[list[str], list[str]]:
    kept: list[str] = []
    warnings: list[str] = []
    for note in notes:
        note_warnings = detect_quality_warnings(note)
        if note_warnings:
            warnings.extend(note_warnings)
            continue
        kept.append(note)
    deduped_warnings: list[str] = []
    for warning in warnings:
        if warning not in deduped_warnings:
            deduped_warnings.append(warning)
    return kept, deduped_warnings


def append_quality_warnings(summary: str, warnings: list[str]) -> str:
    clean_warnings = [warning for warning in warnings if warning]
    if not clean_warnings:
        return summary
    # "## " heading (not bold) so this is its own hideable block — see the
    # note in build_summary_markdown above.
    chunks = [summary.strip(), "", "## Требует проверки качества"]
    chunks.extend(f"- {warning}" for warning in clean_warnings)
    return "\n".join(chunks).strip()


def remove_quality_risky_summary_lines(summary: str) -> tuple[str, list[str]]:
    lines = (summary or "").splitlines()
    kept: list[str] = []
    warnings: list[str] = []
    for line in lines:
        line_warnings = detect_quality_warnings(line)
        if line_warnings:
            warnings.extend(line_warnings)
            continue
        kept.append(line)
    deduped_warnings: list[str] = []
    for warning in warnings:
        if warning not in deduped_warnings:
            deduped_warnings.append(warning)
    return "\n".join(kept).strip(), deduped_warnings


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
        parsed, _ = sanitize_suggested_changes(source_text, parsed)
        return parsed

    parsed.update(_extract_from_text(source_text))
    parsed, _ = sanitize_suggested_changes(source_text, parsed)
    return parsed


def sanitize_suggested_changes(
    source_text: str,
    suggested_changes: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Keep uncertain plans out of structured profile fields.

    Example: "думаю подаваться осенью" is useful context, but it should not
    silently become intake_season=fall. We surface it as a note candidate.
    """
    cleaned = dict(suggested_changes or {})
    unmatched: dict[str, Any] = {}
    if not cleaned:
        return cleaned, unmatched

    compact_text = " ".join((source_text or "").split())
    if not compact_text or not _SPECULATIVE_RE.search(compact_text):
        return cleaned, unmatched

    moved: dict[str, Any] = {}
    for field in list(cleaned.keys()):
        if field in SPECULATIVE_PROFILE_FIELDS:
            moved[field] = cleaned.pop(field)

    if moved:
        unmatched[SPECULATIVE_FIELD_NOTE_KEY] = compact_text[:500]
        unmatched["suggested_but_uncertain"] = moved
    return cleaned, unmatched


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
    """Конспект для менеджера: суть разговора + сравнение с текущей карточкой."""
    chunks: list[str] = [f"## {title.strip() or 'Конспект'}"]

    # NB: these use "## " headings, not "**bold**" — note_blocks.split_blocks()
    # only recognizes #/##/### lines as block boundaries. Bold text used to
    # glue the whole note (including manager-only sections) into one
    # unhideable block, so a mentor publishing this to a student could not
    # hide "Контекст для менеджера" independently of the rest.
    body_lines = [line.strip(" -•\t") for line in source_text.splitlines() if line.strip()]
    if body_lines:
        chunks.append("")
        chunks.append("## Что появилось")
        for line in body_lines[:8]:
            chunks.append(f"- {line}")

    chunks.append("")
    chunks.append("## Сравнение с текущей карточкой")
    if suggested_changes:
        for key, value in suggested_changes.items():
            if key not in NOTEABLE_FIELDS:
                continue
            old = humanize_value(snapshot.get(key))
            new = humanize_value(value)
            chunks.append(f"- {humanize_field(key)}: сейчас {old}, предлагается {new}")
    else:
        chunks.append("- Подтверждённых изменений для полей карточки нет.")

    chunks.append("")
    chunks.append("## Контекст для менеджера")
    if body_lines:
        chunks.append("- Проверьте, какие детали стоит сохранить как отдельные заметки по статусу ученика.")
    else:
        chunks.append("- Источник не содержит текста для анализа.")

    chunks.append("")
    chunks.append("## Рекомендуемые заметки в профиль")
    recommendations = _build_profile_note_recommendations(source_text, suggested_changes)
    if recommendations:
        chunks.extend(f"- {item}" for item in recommendations)
    else:
        chunks.append("- Новых заметок для отслеживания статуса не выявлено.")

    return "\n".join(chunks)


def build_insight_note_markdown(
    *,
    source_text: str,
    snapshot: dict[str, Any],
    proposed_changes: dict[str, Any],
    unmatched_fields: dict[str, Any],
) -> str:
    chunks: list[str] = ["## AI-инсайт из Telegram"]
    compact = " ".join((source_text or "").split())

    chunks.append("")
    chunks.append("**Что сказал студент/родитель**")
    chunks.append(f"- {compact or 'Текст сообщения отсутствует.'}")

    chunks.append("")
    chunks.append("**Сравнение с текущей карточкой**")
    comparable = {key: value for key, value in proposed_changes.items() if key in NOTEABLE_FIELDS}
    if comparable:
        for key, value in comparable.items():
            chunks.append(
                f"- {humanize_field(key)}: сейчас {humanize_value(snapshot.get(key))}, предлагается {humanize_value(value)}"
            )
    else:
        chunks.append("- Подтверждённых изменений для структурных полей нет.")

    context_note = unmatched_fields.get(SPECULATIVE_FIELD_NOTE_KEY)
    uncertain = unmatched_fields.get("suggested_but_uncertain")
    other_unmatched = {
        key: value
        for key, value in unmatched_fields.items()
        if key not in {SPECULATIVE_FIELD_NOTE_KEY, "suggested_but_uncertain"}
    }

    chunks.append("")
    chunks.append("**Как интерпретировать**")
    if context_note and uncertain:
        chunks.append("- В сообщении есть намерение или план, но не подтверждённое изменение профиля.")
        for key, value in dict(uncertain).items():
            chunks.append(f"- Не менять поле «{humanize_field(key)}» автоматически: кандидат был {humanize_value(value)}.")
    elif comparable:
        chunks.append("- Изменение можно применять только после проверки менеджером.")
    else:
        chunks.append("- Это контекстная заметка без изменения полей карточки.")

    if other_unmatched:
        chunks.append("")
        chunks.append("**Несопоставленные детали**")
        for key, value in other_unmatched.items():
            chunks.append(f"- {key}: {humanize_value(value)}")

    chunks.append("")
    chunks.append("**Рекомендуемая заметка в профиль**")
    if context_note:
        chunks.append(f"- {context_note}")
    elif compact:
        chunks.append(f"- Проверить и сохранить контекст из сообщения: {compact[:240]}")
    else:
        chunks.append("- Новых заметок для отслеживания статуса не выявлено.")

    return "\n".join(chunks)


def _build_profile_note_recommendations(source_text: str, suggested_changes: dict[str, Any]) -> list[str]:
    compact = " ".join((source_text or "").split())
    lowered = compact.lower()
    recommendations: list[str] = []

    if not compact:
        return recommendations

    if _SPECULATIVE_RE.search(compact):
        recommendations.append(f"Намерение/план ученика требует уточнения: {compact[:220]}")
    if re.search(r"deadline|дедлайн|до \d|числ|осень|весн|подав", lowered, re.IGNORECASE):
        recommendations.append("Зафиксировать сроки и ближайший контрольный шаг по поступлению.")
    if re.search(r"gpa|гпа|ielts|sat|toefl|экзамен|сертификат|грамот|отчет|отчёт", lowered, re.IGNORECASE):
        recommendations.append("Проверить подтверждающие документы/результаты и отметить, что уже загружено.")
    if re.search(r"бюджет|оплат|деньг|финанс|стоим", lowered, re.IGNORECASE):
        recommendations.append("Отдельно сохранить финансовый контекст: бюджет, ограничения, кто принимает решение.")
    if re.search(r"сомнев|не уверен|не знаю|пережив|риск|проблем", lowered, re.IGNORECASE):
        recommendations.append("Сохранить риск или сомнение ученика, чтобы вернуться к нему на следующем контакте.")

    for field in suggested_changes:
        if field in {"gpa", "achievements_text", "intake_year", "intake_season", "budget_per_year"}:
            recommendations.append(
                f"После подтверждения поля «{humanize_field(field)}» добавить короткий контекст: откуда взялось изменение и что проверить дальше."
            )

    deduped: list[str] = []
    for item in recommendations:
        if item not in deduped:
            deduped.append(item)
    return deduped[:5]


def coerce_student_value(field: str, value: Any) -> Any:
    if field in {"age", "intake_year"}:
        if value in (None, ""):
            return None
        if isinstance(value, str) and not value.strip():
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
        try:
            new_value = coerce_student_value(field, raw_new)
        except (TypeError, ValueError):
            continue
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
