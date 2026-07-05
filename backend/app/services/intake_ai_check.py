from __future__ import annotations

import hashlib
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.intake_ai_check import IntakeAiCheck
from app.services.ai_client import complete_with_fallback, json_block, provider_chain

logger = logging.getLogger(__name__)

# Only fields where a mismatch is plausibly the SAME value in a different
# representation (script/transliteration, translation, phrasing) rather than
# a genuine factual disagreement. Deterministic fields (phone, year, degree)
# are handled by _get_normalizers() in sync.py and don't need this — adding
# more fields here should be a deliberate choice, not a default.
AI_CHECKABLE_FIELDS = {"full_name"}

PROMPT_SYSTEM = """Ты проверяешь анкету студента образовательного консалтинга.
Два человека (менеджер и студент) независимо указали значение одного и того
же поля. Определи: это ОДНО И ТО ЖЕ значение, просто записанное по-другому
(другой алфавит/транслитерация, перевод, порядок слов, сокращение), или это
ДЕЙСТВИТЕЛЬННО разные значения (расхождение, которое нужно показать менеджеру).

Верни ТОЛЬКО JSON без пояснений:
{"same": true/false, "note": "короткое объяснение на русском, до 12 слов"}"""


def _content_hash(field: str, pkg_v: str, cs_v: str) -> str:
    raw = f"{field}|{pkg_v}|{cs_v}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def check_same_meaning(
    db: AsyncSession,
    student_id: uuid.UUID,
    field: str,
    field_label: str,
    pkg_v: str,
    cs_v: str,
) -> tuple[bool | None, str | None]:
    """Returns (same_meaning, note). (None, None) if AI isn't configured or
    the field isn't in the checkable allowlist — callers should treat that
    as "no verdict available", not "confirmed different"."""
    if field not in AI_CHECKABLE_FIELDS or not provider_chain():
        return None, None

    content_hash = _content_hash(field, pkg_v, cs_v)
    cached = await db.execute(
        select(IntakeAiCheck).where(
            IntakeAiCheck.student_id == student_id,
            IntakeAiCheck.field == field,
            IntakeAiCheck.content_hash == content_hash,
        )
    )
    existing = cached.scalar_one_or_none()
    if existing:
        return existing.same_meaning, existing.note

    user_message = f"""Поле: {field_label}
Значение менеджера: {pkg_v}
Значение студента: {cs_v}"""

    try:
        raw = await complete_with_fallback(PROMPT_SYSTEM, user_message)
        parsed = json_block(raw)
        same = bool(parsed.get("same"))
        note = parsed.get("note") if isinstance(parsed.get("note"), str) else None
    except Exception:
        logger.exception("AI intake-mismatch check failed for student=%s field=%s", student_id, field)
        return None, None

    db.add(IntakeAiCheck(
        student_id=student_id,
        field=field,
        content_hash=content_hash,
        same_meaning=same,
        note=note,
    ))
    await db.commit()
    return same, note
