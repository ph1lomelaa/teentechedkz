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
        logger.warning("No AI provider configured, skipping Telegram extraction for message %s", message.id)
        await _notify_admins_ai_provider_missing(db)
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
    proposed_changes = {
        key: value
        for key, value in proposed_changes.items()
        if key in NOTEABLE_FIELDS
    }

    try:
        insight_type = InsightType(parsed.get("insight_type", "status_update"))
    except ValueError:
        insight_type = InsightType.status_update

    confidence = parsed.get("confidence")
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.5

    diff = build_profile_diff(snapshot, proposed_changes)

    # Bug #1 fix: use context_unmatched instead of hardcoded {}
    # Bug #2 fix: fallback path for conversational context (no structured field match)
    if not diff:
        # No structured profile update, but check for speculative/conversational context
        if context_unmatched:
            # Create lightweight insight for context (e.g., "думаю подаваться осенью")
            # This preserves plans/concerns that don't map to structured fields
            insight = PendingInsight(
                student_id=student.id,
                source_telegram_message_id=message.id,
                insight_type=InsightType.status_update,
                proposed_changes={},  # No structured changes
                unmatched_fields=context_unmatched,
                confidence=0.3,  # Lower confidence for context-only insights
                risk_level=RiskLevel.low,
                status=InsightStatus.pending,
            )
            db.add(insight)
            return insight
        # No structured changes and no context — nothing worth surfacing
        return None

    unmatched_fields = context_unmatched

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


async def _notify_admins_ai_provider_missing(db: AsyncSession) -> None:
    """Surface "no AI provider configured" in the admin notification feed, not
    just the logs — this used to be silent (INFO-only, no notification), which
    is exactly why nobody noticed Telegram insight extraction had stopped
    working. Throttled to one notification per day so a busy chat doesn't
    spam this on every message."""
    from datetime import datetime, timedelta, timezone

    from app.models.notification import Notification
    from app.models.user import User, UserRole

    kind = "ai_provider_missing"
    recent = await db.execute(
        select(Notification.id).where(
            Notification.kind == kind,
            Notification.created_at >= datetime.now(timezone.utc) - timedelta(days=1),
        ).limit(1)
    )
    if recent.scalar_one_or_none():
        return

    admins = await db.execute(select(User).where(User.role.in_([UserRole.admin, UserRole.mzk_manager])))
    for admin in admins.scalars():
        db.add(Notification(
            user_id=admin.id,
            kind=kind,
            title="AI-провайдер не настроен",
            body="OPENAI_API_KEY / ANTHROPIC_API_KEY не заданы на сервере — извлечение инсайтов из Telegram-сообщений отключено.",
            priority="high",
        ))
