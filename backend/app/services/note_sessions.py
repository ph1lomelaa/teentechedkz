from __future__ import annotations

import json
import logging
import os
from typing import Any

from app.services.ai_client import complete_with_fallback, json_block, provider_chain
from app.services.student_notes import (
    append_quality_warnings,
    build_student_summary_fallback,
    build_summary_markdown,
    detect_quality_warnings,
    parse_suggested_changes,
    remove_quality_risky_notes,
    remove_quality_risky_summary_lines,
    sanitize_suggested_changes,
)

logger = logging.getLogger(__name__)

MAX_TRANSCRIPT_CHARS = int(os.getenv("MAX_NOTE_TRANSCRIPT_CHARS", "140000"))
CONDENSE_CHUNK_CHARS = int(os.getenv("NOTE_TRANSCRIPT_CHUNK_CHARS", "18000"))

PROMPT_SYSTEM = """Ты ассистент образовательного консультанта.
На входе транскрипт разговора и текущий профиль студента.
Твоя задача: вернуть ТОЛЬКО JSON без пояснений, без markdown-кода и без комментариев.

Формат ответа:
{
  "title": "Короткое название конспекта",
  "summary_markdown": "Структурированный конспект на русском языке",
  "student_summary_markdown": "Тот же разговор, пересказанный студенту",
  "suggested_changes": {
    "field_name": "new_value"
  },
  "profile_notes": ["важная заметка для профиля студента", "..."]
}

ГЛАВНОЕ ПРАВИЛО — только факты из транскрипта:
- Каждое утверждение конспекта должно опираться на конкретную фразу из транскрипта. Если не можешь указать, где это прозвучало, — не пиши.
- ЗАПРЕЩЕНЫ обобщения-заполнители («выразил интерес к различным специальностям», «обсуждались планы») — вместо них пиши, ЧТО именно назвал студент, дословно или близко к тексту.
- ЗАПРЕЩЕНО выдумывать «договорённости» и «следующие шаги», которых в разговоре не проговаривали. Если конкретных договорённостей не было — напиши: «Конкретных договорённостей в разговоре не прозвучало».
- Если транскрипт короткий или пустой по смыслу — конспект должен честно это отразить, а не имитировать содержательность.

suggested_changes:
- Только поля карточки, которые ЯВНО подтверждаются транскриптом. Не уверен — не добавляй.
- Фразы «думаю», «хочу», «планирую», «рассматриваю» — это намерения: в конспект можно, в suggested_changes нельзя.
- Если ничего менять не нужно — пустой объект.

profile_notes — важное, что НЕ ложится в поля карточки, но должно сохраниться у студента:
- мотивация, риски, сомнения, дедлайны, договорённости, семейный контекст, предпочтения.
- 0–5 коротких заметок, каждая — самодостаточное предложение с конкретикой из разговора.
- Только то, что реально прозвучало. Не было важного — верни пустой список [].

Требования к summary_markdown (пиши для менеджера, а не для машины):
- 2–4 предложения о сути разговора, затем короткие блоки «Подтверждённые факты», «Планы/намерения», «Следующие шаги» (только если они реально проговаривались).
- НИКОГДА не вставляй в конспект дамп профиля («Профиль студента…», списки полей со значениями) — профиль и так открыт рядом. Упоминай поле профиля только когда разговор его ИЗМЕНИЛ.
- Никаких технических имён полей (full_name, budget_per_year...) и значений енумов (undergraduate) — только человеческий русский текст («ФИО», «Бакалавриат»).
- Без заголовка первого уровня «#» — начинай сразу с текста или «##».

Требования к student_summary_markdown — это ДРУГОЙ текст, не сокращение summary_markdown:
- Обращайся к студенту на «ты», тепло и просто, как будто пишешь ему лично после звонка.
- Те же факты из транскрипта, что и в summary_markdown, но БЕЗ языка менеджера: никаких «Подтверждённые факты», «Следующие шаги для менеджера», «сравнение с карточкой», названий полей CRM или внутренних пометок.
- 2–3 предложения о разговоре, при необходимости 1–2 коротких блока «##» с простыми заголовками («Что обсудили», «Что дальше») — без канцелярита.
- Если реальных договорённостей не было — напиши это по-дружески, а не «конкретных договорённостей не прозвучало» канцелярским тоном.
- Без заголовка первого уровня «#» — начинай сразу с текста или «##».
"""
PROMPT_VERSION = "note_sessions.v1"


import re

_PROFILE_DUMP_HEADING = re.compile(r"профил[ьяе]\s+студента|снимок\s+профиля", re.IGNORECASE)


def strip_profile_dump(summary: str) -> str:
    """Модель иногда игнорирует запрет и вклеивает в конспект дамп профиля
    («Профиль студента на момент…» + список полей). Вырезаем такую секцию:
    от строки-заголовка с упоминанием профиля до следующего заголовка."""
    lines = summary.splitlines()
    out: list[str] = []
    skipping = False
    for line in lines:
        stripped = line.strip().strip("*#").strip()
        is_heading = line.lstrip().startswith("#") or (
            line.strip().startswith("**") and line.strip().endswith("**")
        )
        if _PROFILE_DUMP_HEADING.search(stripped) and (is_heading or len(stripped) < 80):
            skipping = True
            continue
        if skipping and is_heading:
            skipping = False
        if not skipping:
            out.append(line)
    return "\n".join(out).strip()


def parse_profile_notes(raw) -> list[str]:
    """profile_notes из ответа модели → до 5 непустых строк по 500 символов."""
    if not isinstance(raw, list):
        return []
    notes = []
    for item in raw:
        text = " ".join(str(item or "").split())
        if text:
            notes.append(text[:500])
    return notes[:5]


def _condense_transcript(transcript: str) -> str:
    if len(transcript) <= MAX_TRANSCRIPT_CHARS:
        return transcript

    lines = transcript.splitlines()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        if current and current_len + len(line) > CONDENSE_CHUNK_CHARS:
            chunks.append("\n".join(current))
            current = []
            current_len = 0
        current.append(line)
        current_len += len(line) + 1
    if current:
        chunks.append("\n".join(current))
    return "\n\n".join(chunk[:CONDENSE_CHUNK_CHARS] for chunk in chunks)


def _heuristic_note_draft(
    source_title: str,
    transcript: str,
    snapshot: dict[str, Any],
    *,
    reason: str,
) -> dict[str, Any]:
    """Rule-based конспект used when no AI provider is configured or the
    provider call fails. `reason` is surfaced in __ai_meta so the fallback is
    never silently mistaken for a real AI run."""
    summary = build_summary_markdown(source_title, transcript, snapshot, {})
    quality_warnings = detect_quality_warnings(transcript)
    summary, summary_quality_warnings = remove_quality_risky_summary_lines(summary)
    quality_warnings.extend(
        warning for warning in summary_quality_warnings if warning not in quality_warnings
    )
    summary = append_quality_warnings(summary, quality_warnings)
    return {
        "title": source_title,
        "summary_markdown": summary,
        "student_summary_markdown": build_student_summary_fallback(source_title),
        "suggested_changes": {},
        "__ai_meta": {
            "prompt_version": PROMPT_VERSION,
            "model": "heuristic",
            "raw_output": None,
            "parsed_output": {},
            "filter_reasons": {"fallback": reason},
        },
    }


async def generate_note_draft(
    *,
    transcript: str,
    title: str,
    snapshot: dict[str, Any],
    student_name: str | None = None,
) -> dict[str, Any]:
    transcript = _condense_transcript(transcript)
    source_title = title.strip() or f"Конспект {student_name or 'студента'}"
    user_message = f"""Текущий профиль студента:
{json.dumps(snapshot, ensure_ascii=False, indent=2)}

Имя студента: {student_name or 'Не указано'}
Название конспекта: {source_title}

Транскрипт:
{transcript}

Верни JSON с title, summary_markdown и suggested_changes."""

    if not provider_chain():
        return _heuristic_note_draft(
            source_title, transcript, snapshot, reason="AI provider is not configured"
        )

    try:
        raw = await complete_with_fallback(PROMPT_SYSTEM, user_message)
    except Exception:
        # Never 500 the конспект on a provider hiccup (timeout, quota, network) —
        # degrade to the rule-based draft, clearly marked, so the UI keeps working.
        logger.exception("Note draft AI provider failed; using heuristic fallback")
        return _heuristic_note_draft(
            source_title, transcript, snapshot, reason="AI provider error"
        )
    parsed = json_block(raw)
    suggested_changes = parsed.get("suggested_changes")
    if not isinstance(suggested_changes, dict):
        suggested_changes = parse_suggested_changes(None, transcript)
    else:
        suggested_changes, _ = sanitize_suggested_changes(transcript, suggested_changes)

    # Важное, что не ложится в поля карточки, — сохранится в заметки студента
    # при подтверждении конспекта. Возим внутри suggested_changes (JSON-поле),
    # apply_student_updates этот ключ игнорирует.
    profile_notes = parse_profile_notes(parsed.get("profile_notes"))
    profile_notes, note_quality_warnings = remove_quality_risky_notes(profile_notes)
    if profile_notes:
        suggested_changes["profile_notes"] = profile_notes

    quality_warnings = []
    quality_warnings.extend(detect_quality_warnings(transcript))
    quality_warnings.extend(note_quality_warnings)
    deduped_quality_warnings = []
    for warning in quality_warnings:
        if warning not in deduped_quality_warnings:
            deduped_quality_warnings.append(warning)

    summary = parsed.get("summary_markdown")
    if not isinstance(summary, str) or not summary.strip():
        summary = build_summary_markdown(source_title, transcript, snapshot, suggested_changes)
    else:
        summary = strip_profile_dump(summary)
    summary, summary_quality_warnings = remove_quality_risky_summary_lines(summary)
    deduped_quality_warnings.extend(
        warning for warning in summary_quality_warnings if warning not in deduped_quality_warnings
    )
    summary = append_quality_warnings(summary, deduped_quality_warnings)

    student_summary = parsed.get("student_summary_markdown")
    if not isinstance(student_summary, str) or not student_summary.strip():
        student_summary = build_student_summary_fallback(source_title)
    else:
        student_summary = strip_profile_dump(student_summary)
    # Strip the same risky lines a student shouldn't see either, but skip
    # append_quality_warnings — the "Требует проверки качества" banner is a
    # manager-only QA flag, not something to surface to the student.
    student_summary, _ = remove_quality_risky_summary_lines(student_summary)

    next_title = parsed.get("title")
    if not isinstance(next_title, str) or not next_title.strip():
        next_title = source_title

    return {
        "title": next_title.strip(),
        "summary_markdown": summary.strip(),
        "student_summary_markdown": student_summary.strip(),
        "suggested_changes": suggested_changes,
        "__ai_meta": {
            "prompt_version": PROMPT_VERSION,
            "model": "provider_chain",
            "raw_output": raw,
            "parsed_output": parsed,
            "filter_reasons": {
                "quality_warnings": deduped_quality_warnings,
            },
        },
    }


REFORMULATE_PROMPT_SYSTEM = """Ты помогаешь образовательному консультанту.
На входе — конспект разговора, написанный для менеджера. Перепиши его для
студента, который будет читать этот текст в своём личном кабинете.
Верни ТОЛЬКО JSON без пояснений: {"student_summary_markdown": "..."}

Требования:
- Обращайся к студенту на «ты», тепло и просто, как будто пишешь ему лично.
- Сохрани те же факты, но убери язык менеджера: никаких «Подтверждённые
  факты», «Следующие шаги для менеджера», сравнений с карточкой профиля,
  названий полей CRM или служебных пометок вроде «Требует проверки качества».
- 2–3 предложения о разговоре, при необходимости 1–2 коротких блока «##» с
  простыми заголовками («Что обсудили», «Что дальше»).
- Без заголовка первого уровня «#» — начинай сразу с текста или «##».
"""


async def reformulate_for_student(summary_markdown: str, student_name: str | None = None) -> str:
    """Reword an already-approved/edited mentor summary for the student's own
    voice, without re-touching suggested_changes or re-reading the transcript
    (cheaper than a full generate_note_draft re-run, and lets a mentor
    regenerate after hand-editing the mentor text)."""
    title = student_name or "студента"
    user_message = f"Конспект для менеджера (студент: {title}):\n\n{summary_markdown}"

    if not provider_chain():
        return build_student_summary_fallback(title)

    try:
        raw = await complete_with_fallback(REFORMULATE_PROMPT_SYSTEM, user_message)
        parsed = json_block(raw)
    except Exception:
        logger.exception("Student summary reformulation failed; using fallback text")
        return build_student_summary_fallback(title)

    student_summary = parsed.get("student_summary_markdown")
    if not isinstance(student_summary, str) or not student_summary.strip():
        return build_student_summary_fallback(title)

    student_summary = strip_profile_dump(student_summary)
    student_summary, _ = remove_quality_risky_summary_lines(student_summary)
    return student_summary.strip()
