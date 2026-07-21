from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.services.ai_client import complete_with_fallback, json_block, provider_chain
from app.services.student_notes import build_profile_diff, detect_quality_warnings, sanitize_suggested_changes

logger = logging.getLogger(__name__)


PROMPT_SYSTEM = """Ты ассистент образовательного консультанта.
На входе текущий профиль студента и фрагмент диалога из одного или нескольких каналов.
Твоя задача — подготовить редактируемый черновик действий для менеджера, а не применять изменения.

Верни ТОЛЬКО JSON:
{
  "summary": "короткая выжимка по диалогу",
  "profile_updates": [{"field": "field_name", "value": "new value", "reason": "почему это подтверждено"}],
  "profile_notes": ["важная заметка для профиля"],
  "follow_ups": ["что проверить позже"],
  "document_flags": ["что проверить по вложениям/документам"],
  "contradictions": ["что конфликтует с текущим профилем или звучит неоднозначно"],
  "quality_warnings": ["сомнительные распознавания или нелогичные фразы"],
  "ignored_as_noise": ["что сознательно не сохранять"]
}

Правила отбора:
- Анализируй диалог целиком, а не каждую фразу отдельно.
- Не создавай много мелких заметок. Объединяй связанные фразы в 1–4 полезных пункта.
- profile_updates — только подтверждённые факты, которые реально должны изменить поле профиля.
- Намерения ("хочу", "планирую", "посмотрим", "ближе к осени") не являются изменением профиля; это profile_notes или follow_ups.
- Мнение родителя не равно выбору студента. Сохраняй как семейный контекст, не как specialty.
- Если есть фраза про сертификат/файл, но результата из файла не видно, создай document_flags, не выдумывай баллы.
- IELTS/SAT/TOEFL: не выдумывай результат. Фразы вида "IELTS до нуля", "поднял до 0" помечай как quality_warnings.
- Если важного нет, верни пустые массивы.
"""

NOTE_LIMIT = 8
PROMPT_VERSION = "student_context_ai.v1"


def _compact(value: Any, limit: int = 500) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def _list_of_strings(raw: Any, *, limit: int = NOTE_LIMIT, item_limit: int = 500) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        text = _compact(item, item_limit)
        if text and text not in out:
            out.append(text)
    return out[:limit]


def _profile_updates(raw: Any, source_text: str, snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    proposed: dict[str, Any] = {}
    reasons: dict[str, str] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        field = _compact(item.get("field"), 80)
        if not field:
            continue
        proposed[field] = item.get("value")
        reason = _compact(item.get("reason"), 300)
        if reason:
            reasons[field] = reason

    cleaned, _ = sanitize_suggested_changes(source_text, proposed)
    diff = build_profile_diff(snapshot, cleaned)
    return [
        {
            "field": item["field"],
            "value": item["new_value"],
            "old_value": item["old_value"],
            "reason": reasons.get(item["field"], ""),
        }
        for item in diff
    ]


def _heuristic_context_draft(source_text: str, attachments: list[dict[str, Any]], snapshot: dict[str, Any]) -> dict[str, Any]:
    compact = _compact(source_text, 3000)
    lowered = compact.lower()
    notes: list[str] = []
    follow_ups: list[str] = []
    document_flags: list[str] = []
    warnings: list[str] = []

    if re.search(r"\bielts\b|айл[тт]с|toefl|sat", lowered, re.IGNORECASE):
        exam_date = re.search(r"(?:ielts|айл[тт]с|toefl|sat).{0,40}?(\d{1,2}\s+[а-яa-z]+|\d{1,2}[./-]\d{1,2})", compact, re.IGNORECASE)
        if exam_date:
            notes.append(f"В диалоге упомянут экзамен: {exam_date.group(0).strip()}.")
            follow_ups.append("Проверить результат экзамена после указанной даты.")
        else:
            notes.append("В диалоге есть упоминание IELTS/TOEFL/SAT; результат не подтверждён.")
    if re.search(r"документ|сертификат|аттестат|транскрипт|файл", lowered, re.IGNORECASE):
        document_flags.append("Проверить отправленные документы/сертификаты вручную.")
    if re.search(r"документ\w*\s+ещ[её]\s+не\s+сдал|не\s+сдал\w*\s+документ", lowered, re.IGNORECASE):
        notes.append("Документы ещё не сданы; нужен контроль статуса подачи.")
        follow_ups.append("Уточнить, какие документы не сданы и когда студент сможет их отправить.")
    if re.search(r"хочу|планирую|посмотрим|ближе\s+к\s+осен", lowered, re.IGNORECASE):
        notes.append("В диалоге есть намерения по поступлению, но без подтверждённого изменения полей карточки.")
    warnings.extend(detect_quality_warnings(compact))
    if attachments:
        names = ", ".join(_compact(a.get("file_name") or a.get("mime_type") or "файл", 80) for a in attachments[:5])
        document_flags.append(f"В чате есть вложения для проверки: {names}.")

    draft = {
        "summary": "AI-провайдер не настроен; черновик собран по базовым правилам.",
        "profile_updates": [],
        "profile_notes": _list_of_strings(notes),
        "follow_ups": _list_of_strings(follow_ups),
        "document_flags": _list_of_strings(document_flags),
        "contradictions": [],
        "quality_warnings": _list_of_strings(warnings),
        "ignored_as_noise": [],
    }
    draft["__ai_meta"] = {
        "prompt_version": PROMPT_VERSION,
        "model": "heuristic",
        "raw_output": None,
        "parsed_output": {key: value for key, value in draft.items() if key != "__ai_meta"},
        "filter_reasons": {"fallback": "AI provider is not configured"},
    }
    return draft


async def generate_context_review_draft(
    *,
    source_text: str,
    snapshot: dict[str, Any],
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    attachments = attachments or []
    if not provider_chain():
        return _heuristic_context_draft(source_text, attachments, snapshot)

    user_message = f"""Текущий профиль студента:
{json.dumps(snapshot, ensure_ascii=False, indent=2)}

Вложения в диалоге:
{json.dumps(attachments, ensure_ascii=False, indent=2)}

История диалога:
{source_text}

Верни JSON с summary, profile_updates, profile_notes, follow_ups, document_flags, contradictions, quality_warnings, ignored_as_noise."""

    try:
        raw = await complete_with_fallback(PROMPT_SYSTEM, user_message)
    except Exception:
        # Degrade gracefully on a provider hiccup instead of 500-ing the caller.
        logger.exception("Context review AI provider failed; using heuristic fallback")
        return _heuristic_context_draft(source_text, attachments, snapshot)
    parsed = json_block(raw)
    if not parsed:
        return _heuristic_context_draft(source_text, attachments, snapshot)

    draft = {
        "summary": _compact(parsed.get("summary"), 1000),
        "profile_updates": _profile_updates(parsed.get("profile_updates"), source_text, snapshot),
        "profile_notes": _list_of_strings(parsed.get("profile_notes")),
        "follow_ups": _list_of_strings(parsed.get("follow_ups")),
        "document_flags": _list_of_strings(parsed.get("document_flags")),
        "contradictions": _list_of_strings(parsed.get("contradictions")),
        "quality_warnings": _list_of_strings(parsed.get("quality_warnings")),
        "ignored_as_noise": _list_of_strings(parsed.get("ignored_as_noise")),
    }
    if not any(draft[key] for key in ("profile_updates", "profile_notes", "follow_ups", "document_flags", "contradictions", "quality_warnings")):
        return _heuristic_context_draft(source_text, attachments, snapshot)
    draft["__ai_meta"] = {
        "prompt_version": PROMPT_VERSION,
        "model": "provider_chain",
        "raw_output": raw,
        "parsed_output": parsed,
        "filter_reasons": {},
    }
    return draft
