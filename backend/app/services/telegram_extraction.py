"""Turns raw Telegram messages/attachments into a pending_insight draft.

Runs after ingest_message() commits, once a chat is bound to a student.
Never writes to the student record directly — always goes through
pending_insights, so the manager approve/reject flow stays the single
place changes get applied (see communication.py: review_insight).

Что в очередь «Статус» НЕ попадает
----------------------------------
Очередь была завалена мусором, и каждое правило ниже закрывает один его вид:

- сообщения сотрудников и ботов — ссылки-приглашения, шаблоны, наши же
  welcome-ссылки превращались в «новый телефон» и «транскрипт»;
- один и тот же текст, уже пришедший в другой чат за сутки, — рассылка
  по группам давала одинаковые карточки у разных студентов;
- значения, не прошедшие `validate_proposed_changes`;
- низкая уверенность модели (< MIN_CONFIDENCE);
- «контекст без изменений полей» — раньше это карточка «не сопоставлено,
  30%» с сырым текстом сообщения; сам текст и так лежит в чате;
- повтор уже ждущего проверки предложения по тому же студенту.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pending_insight import InsightStatus, InsightType, PendingInsight, RiskLevel
from app.models.student import Student
from app.models.telegram_message import TelegramMessage
from app.services.ai_client import complete_with_fallback, json_block, provider_chain
from app.services.student_notes import (
    NOTEABLE_FIELDS,
    build_profile_diff,
    sanitize_suggested_changes,
    snapshot_student,
    validate_proposed_changes,
)

logger = logging.getLogger(__name__)

#: Ниже этого предложение не показываем: ревьюер всё равно отклонит, а
#: очередь из таких карточек перестают читать целиком.
MIN_CONFIDENCE = 0.6

#: Короче этого текст не считаем рассылкой — «Спасибо!» пишут все.
_BROADCAST_MIN_LENGTH = 40

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
- Ссылки-приглашения, ссылки на личный кабинет, шаблонные объявления и рассылки — не источник изменений.
- phone — только номер телефона цифрами; коды, токены и ссылки телефоном не являются.
- transcript_resume_url — только ссылка на документ студента, не ссылка на кабинет или чат.
- Если сообщение не содержит ничего значимого для профиля, верни proposed_changes пустым объектом и confidence 0.
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

    if await _sent_by_staff(db, message):
        return None
    if await _is_broadcast(db, message, text):
        logger.info("Telegram message %s looks like a broadcast, skipping extraction", message.id)
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
    # Неуверенные планы («думаю подаваться осенью») из полей убираем и больше
    # не превращаем в отдельную карточку: текст и так виден в чате.
    proposed_changes, _speculative = sanitize_suggested_changes(text, proposed_changes)
    proposed_changes = {
        key: value
        for key, value in proposed_changes.items()
        if key in NOTEABLE_FIELDS
    }
    proposed_changes = validate_proposed_changes(proposed_changes, snapshot)

    try:
        insight_type = InsightType(parsed.get("insight_type", "status_update"))
    except ValueError:
        insight_type = InsightType.status_update

    confidence = parsed.get("confidence")
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
    if confidence < MIN_CONFIDENCE:
        return None

    diff = build_profile_diff(snapshot, proposed_changes)
    if not diff:
        return None
    # В карточку идут только реально меняющиеся поля.
    proposed_changes = {d["field"]: proposed_changes[d["field"]] for d in diff}

    if await _same_change_pending(db, student.id, proposed_changes):
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
        unmatched_fields={},
        confidence=confidence,
        risk_level=risk_level,
        status=InsightStatus.pending,
    )

    db.add(insight)
    return insight


async def _sent_by_staff(db: AsyncSession, message: TelegramMessage) -> bool:
    """Написал ли это сотрудник или бот — их сообщения не про изменения студента.

    Признаков несколько, потому что ни один не надёжен сам по себе: из CRM
    сообщение помечено `sent_by_user_id`; в группе сотрудника узнаём по
    Telegram-аккаунту в users или по роли участника, отмеченной в чате.
    """
    from app.models.telegram_participant_identity import TelegramParticipantIdentity
    from app.models.user import User, UserRole

    if message.sent_by_user_id:
        return True

    payload = message.raw_payload or {}
    sender = payload.get("from_user") or payload.get("from") or {}
    if isinstance(sender, dict) and sender.get("is_bot"):
        return True

    if message.sender_tg_id is None:
        return False

    participant_role = (
        await db.execute(
            select(TelegramParticipantIdentity.role).where(
                TelegramParticipantIdentity.chat_id == message.chat_id,
                TelegramParticipantIdentity.telegram_user_id == message.sender_tg_id,
            )
        )
    ).scalar_one_or_none()
    if participant_role == "mentor":
        return True

    user_role = (
        await db.execute(
            select(User.role).where(User.telegram_id == str(message.sender_tg_id)).limit(1)
        )
    ).scalar_one_or_none()
    return user_role is not None and user_role != UserRole.student


async def _is_broadcast(db: AsyncSession, message: TelegramMessage, text: str) -> bool:
    """Тот же длинный текст уже пришёл в другой чат за сутки — это рассылка."""
    if len(text) < _BROADCAST_MIN_LENGTH:
        return False
    since = (message.created_at or datetime.now(timezone.utc)) - timedelta(hours=24)
    other = (
        await db.execute(
            select(TelegramMessage.id)
            .where(
                TelegramMessage.raw_text == message.raw_text,
                TelegramMessage.chat_id != message.chat_id,
                TelegramMessage.created_at >= since,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return other is not None


async def _same_change_pending(db: AsyncSession, student_id, proposed_changes: dict) -> bool:
    """Такое же предложение по этому студенту уже ждёт проверки."""
    pending = await db.execute(
        select(PendingInsight.proposed_changes).where(
            PendingInsight.student_id == student_id,
            PendingInsight.status == InsightStatus.pending,
        )
    )
    return any((existing or {}) == proposed_changes for existing in pending.scalars().all())


async def _notify_admins_ai_provider_missing(db: AsyncSession) -> None:
    """Surface "no AI provider configured" in the admin notification feed, not
    just the logs — this used to be silent (INFO-only, no notification), which
    is exactly why nobody noticed Telegram insight extraction had stopped
    working. Throttled to one notification per day so a busy chat doesn't
    spam this on every message."""
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
