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
  }
}

Правила:
- Не выдумывай факты.
- Если изменение не подтверждается транскриптом, не добавляй его.
- Отделяй подтверждённые факты от планов и намерений. Фразы вроде "думаю", "хочу", "планирую", "рассматриваю" должны попасть в summary_markdown как заметка, но не в suggested_changes.
- suggested_changes должен содержать только поля карточки студента, которые реально надо обновить.
- Если ничего менять не нужно, suggested_changes верни пустым объектом.

Требования к summary_markdown (пиши для менеджера, а не для машины):
- 2–4 предложения о сути разговора, затем короткие блоки «Сравнение с текущей карточкой», «Подтверждённые факты», «Планы/намерения», «Рекомендуемые заметки в профиль», «Следующие шаги».
- В «Сравнение с текущей карточкой» прямо укажи, что уже было в профиле и что появилось в разговоре.
- В «Рекомендуемые заметки в профиль» предложи 2–5 конкретных заметок для отслеживания статуса ученика: мотивация, риски, дедлайны, сомнения, договорённости, важные предпочтения, документы/экзамены/финансы. Пиши так, чтобы менеджер мог сразу понять, стоит ли сохранить заметку.
- Не пиши очевидные дубли полей профиля как заметки. Например, если GPA уже предложен как поле, заметка должна объяснять контекст: почему это важно, насколько подтверждено, что проверить дальше.
- НЕ дублируй профиль студента (он и так открыт рядом) и НЕ перечисляй поля базы.
- Никаких технических имён полей (full_name, budget_per_year...) и значений енумов (undergraduate) — только человеческий русский текст («ФИО», «Бакалавриат»).
- Без заголовка первого уровня «#» — начинай сразу с текста или «##».
"""


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

    summary = parsed.get("summary_markdown")
    if not isinstance(summary, str) or not summary.strip():
        summary = build_summary_markdown(source_title, transcript, snapshot, suggested_changes)

    next_title = parsed.get("title")
    if not isinstance(next_title, str) or not next_title.strip():
        next_title = source_title

    return {
        "title": next_title.strip(),
        "summary_markdown": summary.strip(),
        "suggested_changes": suggested_changes,
    }
