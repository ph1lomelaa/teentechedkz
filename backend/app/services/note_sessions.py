from __future__ import annotations

import json
import logging
import os
from typing import Any

from app.services.ai_client import complete_with_fallback, json_block, provider_chain
from app.services.student_notes import build_summary_markdown, parse_suggested_changes, sanitize_suggested_changes

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
"""


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
        summary = build_summary_markdown(source_title, transcript, snapshot, {})
        return {
            "title": source_title,
            "summary_markdown": summary,
            "suggested_changes": {},
        }

    raw = await complete_with_fallback(PROMPT_SYSTEM, user_message)
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
    if profile_notes:
        suggested_changes["profile_notes"] = profile_notes

    summary = parsed.get("summary_markdown")
    if not isinstance(summary, str) or not summary.strip():
        summary = build_summary_markdown(source_title, transcript, snapshot, suggested_changes)
    else:
        summary = strip_profile_dump(summary)

    next_title = parsed.get("title")
    if not isinstance(next_title, str) or not next_title.strip():
        next_title = source_title

    return {
        "title": next_title.strip(),
        "summary_markdown": summary.strip(),
        "suggested_changes": suggested_changes,
    }
