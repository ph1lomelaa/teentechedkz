"""Turns raw Telegram messages/attachments into a pending_insight draft.

Runs after ingest_message() commits, once a chat is bound to a student.
Never writes to the student record directly — always goes through
pending_insights, so the manager approve/reject flow stays the single
place changes get applied (see communication.py: review_insight).
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pending_insight import InsightStatus, InsightType, PendingInsight, RiskLevel
from app.models.student import Student
from app.models.telegram_message import TelegramMessage
from app.services.ai_client import complete_with_fallback, json_block, provider_chain
from app.services.student_notes import NOTEABLE_FIELDS, build_profile_diff, sanitize_suggested_changes, snapshot_student

logger = logging.getLogger(__name__)

PROMPT_SYSTEM = """Ты ассистент образовательного консультанта.
На входе сообщение из Telegram-чата с родителем/студентом и текущий профиль студента.
Твоя задача: вернуть ТОЛЬКО JSON без пояснений, без markdown-кода и без комментариев.

Формат ответа:
{
  "insight_type": "call_summary|status_update|contact_change|payment_event|service_result|document_flag",
  "proposed_changes": {"field_name": "new_value"},
  "confidence": 0.0
}

Правила:
- Не выдумывай факты, бери только то, что прямо сказано в сообщении.
- proposed_changes должен содержать только поля карточки студента, которые реально надо обновить.
- Намерения, планы и предположения ("думаю", "хочу", "планирую", "осенью ближе к 20 числам") не являются изменением поля профиля.
- Если сообщение не содержит ничего значимого для профиля, verni proposed_changes пустым объектом и confidence 0.
- confidence — твоя уверенность в правильности предложенных изменений, от 0 до 1.
"""


async def extract_insight_from_message(db: AsyncSession, message: TelegramMessage) -> PendingInsight | None:
    if not message.session_id:
        return None

    from app.models.telegram_chat_session import TelegramChatSession

    session = await db.get(TelegramChatSession, message.session_id)
    if not session or not session.student_id:
        return None

    text = (message.raw_text or "").strip()
    if not text:
        return None

    student = await db.get(Student, session.student_id)
    if not student:
        return None

    if not provider_chain():
        logger.info("No AI provider configured, skipping Telegram extraction for message %s", message.id)
        return None

    snapshot = snapshot_student(student)
    user_message = f"""Текущий профиль студента:
{json.dumps(snapshot, ensure_ascii=False, indent=2)}

Сообщение из Telegram:
{text}

Верни JSON с insight_type, proposed_changes и confidence."""

    try:
        raw = await complete_with_fallback(PROMPT_SYSTEM, user_message)
    except Exception:
        logger.exception("AI extraction failed for Telegram message %s", message.id)
        return None

    parsed = json_block(raw)
    proposed_changes = parsed.get("proposed_changes")
    if not isinstance(proposed_changes, dict) or not proposed_changes:
        return None
    proposed_changes, context_unmatched = sanitize_suggested_changes(text, proposed_changes)

    try:
        insight_type = InsightType(parsed.get("insight_type", "status_update"))
    except ValueError:
        insight_type = InsightType.status_update

    confidence = parsed.get("confidence")
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.5

    diff = build_profile_diff(snapshot, proposed_changes)
    unmatched_fields = {k: v for k, v in proposed_changes.items() if k not in NOTEABLE_FIELDS}
    unmatched_fields.update(context_unmatched)
    if not diff and not unmatched_fields:
        # LLM returned fields that don't actually differ from the current
        # profile (hallucinated or no-op) — nothing worth surfacing.
        return None

    touches_phone = any(d["field"] == "phone" for d in diff)
    risk_level = (
        RiskLevel.sensitive
        if touches_phone or insight_type == InsightType.contact_change
        else RiskLevel.low
    )

    insight = PendingInsight(
        student_id=student.id,
        source_telegram_message_id=message.id,
        insight_type=insight_type,
        proposed_changes=proposed_changes,
        unmatched_fields=unmatched_fields,
        confidence=confidence,
        risk_level=risk_level,
        status=InsightStatus.pending,
    )

    db.add(insight)
    return insight
