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
    build_profile_diff,
    snapshot_student,
)

from app.services.profile_recognition import (
    PROFILE_RECOGNITION_RULES, PROMPT_VERSION, confidence, recognize_profile_changes, same_field_value,
)
from app.services.telegram_recognition_context import preceding_context, message_roles
from app.models.ai_analysis_run import AiAnalysisRun

logger = logging.getLogger(__name__)

#: Ниже этого предложение не показываем: ревьюер всё равно отклонит, а
#: очередь из таких карточек перестают читать целиком.
MIN_CONFIDENCE = 0.85

#: Короче этого текст не считаем рассылкой — «Спасибо!» пишут все.
_BROADCAST_MIN_LENGTH = 40


PROMPT_SYSTEM = """Ты ассистент образовательного консультанта.
Разбери НОВОЕ сообщение с учётом предыдущей переписки и текущей карточки.
История нужна только для понимания: не создавай изменения из старых реплик.
При неоднозначном коротком ответе без ясного контекста не предлагай изменение.
Верни только JSON:
{"insight_type":"status_update|contact_change|document_flag|service_result",
 "proposed_changes":{"field_name":"value"},
 "change_evidence":{"field_name":{"quote":"дословная фраза НОВОГО сообщения",
 "kind":"confirmed_fact","subject":"student","confidence":0.95,"operation":"set"}},
 "confidence":0.95}
Если подтверждённых изменений нет, proposed_changes и change_evidence пустые.
""" + PROFILE_RECOGNITION_RULES


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

    if await _sent_by_staff(db, message, student_id=session.student_id):
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
    context = await preceding_context(db, message, student_id=student.id)
    user_message = json.dumps({
        "student_profile": snapshot,
        "preceding_dialog": json.loads(context),
        "new_message": {"id": str(message.id), "text": text},
        "instruction": "Изменения только из new_message; change_evidence.quote дословно из его text.",
    }, ensure_ascii=False, indent=2)

    try:
        raw = await complete_with_fallback(PROMPT_SYSTEM, user_message)
    except Exception:
        logger.exception("AI extraction failed for Telegram message %s", message.id)
        return None

    parsed = json_block(raw)
    proposed_changes, filter_reasons = recognize_profile_changes(
        parsed.get("proposed_changes"), parsed.get("change_evidence"),
        source_text=text, snapshot=snapshot, context_text=context, message_id=str(message.id),
    )
    audit = AiAnalysisRun(
        source_type="telegram_profile_extraction", source_id=message.id,
        student_id=student.id, source_last_message_id=message.id,
        status="draft_created" if proposed_changes else "filtered",
        prompt_version=PROMPT_VERSION, model="provider_chain",
        input_snapshot={"profile_snapshot": snapshot, "context_message_ids": [row["message_id"] for row in json.loads(context) if "message_id" in row]},
        raw_output=raw, parsed_output=parsed,
        filter_reasons=filter_reasons,
    )
    db.add(audit)

    try:
        insight_type = InsightType(parsed.get("insight_type", "status_update"))
    except ValueError:
        insight_type = InsightType.status_update

    score = confidence(parsed.get("confidence"))
    if score < MIN_CONFIDENCE:
        audit.status = "filtered"
        audit.filter_reasons = {**filter_reasons, "overall_confidence": "uncertain"}
        return None

    diff = build_profile_diff(snapshot, proposed_changes)
    if not diff:
        return None
    # В карточку идут только реально меняющиеся поля.
    proposed_changes = {d["field"]: proposed_changes[d["field"]] for d in diff}

    if await _same_change_pending(db, student.id, proposed_changes):
        audit.status = "duplicate"
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
        confidence=score,
        risk_level=risk_level,
        status=InsightStatus.pending,
    )

    db.add(insight)
    return insight


async def _sent_by_staff(db: AsyncSession, message: TelegramMessage, *, student_id=None) -> bool:
    """Написал ли это сотрудник или бот — их сообщения не про изменения студента.

    Признаков несколько, потому что ни один не надёжен сам по себе: из CRM
    сообщение помечено `sent_by_user_id`; в группе сотрудника узнаём по
    Telegram-аккаунту в users или по роли участника, отмеченной в чате.
    """
    return (await message_roles(db, [message], student_id=student_id)).get(message.id) in {"staff", "bot", "other_student"}


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
    return any(
        all(field in (existing or {}) and same_field_value(field, value, existing[field])
            for field, value in proposed_changes.items())
        for existing in pending.scalars().all()
    )


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
