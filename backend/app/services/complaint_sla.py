"""SLA-цикл книги жалоб (ОС 30/07, Блок D).

Два режима, а не один (§ доп. логика 1 плана):
- предупреждение ментору/ответственному, когда до нарушения осталось < 4ч —
  чтобы успеть, а не только constatировать провал постфактум;
- нарушение (> 24ч без ComplaintReply) — руководителю (admin/mzk_manager).

Дедуп — тот же приём, что у payment_notifier/task_review_requested: идентичность
обращения кодируется в body ("[complaint:{id}]"), has_unread/dismiss_unread не
дают спамить одним и тем же уведомлением на каждый прогон цикла.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.complaint import Complaint, ComplaintStatus
from app.models.user import User, UserRole
from app.services.notify import has_unread, notify, push_notification

logger = logging.getLogger(__name__)

SLA_HOURS = 24
WARNING_HOURS_LEFT = 4


async def check_complaint_sla() -> None:
    db = AsyncSessionLocal()
    try:
        result = await db.execute(
            select(Complaint).where(Complaint.status.in_((ComplaintStatus.new, ComplaintStatus.in_progress)))
        )
        open_complaints = result.scalars().all()
        if not open_complaints:
            return

        now = datetime.now(timezone.utc)
        managers_result = await db.execute(
            select(User.id).where(User.role.in_((UserRole.admin, UserRole.mzk_manager)), User.is_active == True)  # noqa: E712
        )
        manager_ids = [row[0] for row in managers_result.all()]

        fresh_notes = []
        newly_breached = 0
        for c in open_complaints:
            elapsed = now - c.created_at
            hours_left = SLA_HOURS - elapsed.total_seconds() / 3600
            complaint_key = f"[complaint:{c.id}]"

            if hours_left <= 0:
                if not c.is_sla_breached:
                    c.is_sla_breached = True
                    newly_breached += 1
                for uid in manager_ids:
                    if await has_unread(db, uid, kind="complaint_sla_breach", body_contains=complaint_key):
                        continue
                    fresh_notes.append(notify(
                        db, uid,
                        kind="complaint_sla_breach",
                        title="SLA по обращению нарушен",
                        body=f"{c.subject}: нет ответа больше {SLA_HOURS}ч {complaint_key}",
                        link="/workspace/complaints",
                        priority="high",
                    ))
            elif hours_left <= WARNING_HOURS_LEFT:
                # Неназначенное обращение раньше пропускалось молча и узнать о
                # нём можно было только постфактум, уже по факту пробоя SLA.
                # Предупреждаем менеджеров — назначить исполнителя могут они.
                recipients = [c.assigned_to] if c.assigned_to else manager_ids
                unassigned = c.assigned_to is None
                for recipient in recipients:
                    if await has_unread(db, recipient, kind="complaint_sla_warning", body_contains=complaint_key):
                        continue
                    fresh_notes.append(notify(
                        db, recipient,
                        kind="complaint_sla_warning",
                        title="Скоро истечёт SLA по обращению",
                        body=(
                            f"{c.subject}: осталось меньше {WARNING_HOURS_LEFT}ч на ответ"
                            + (", исполнитель не назначен" if unassigned else "")
                            + f" {complaint_key}"
                        ),
                        link="/workspace/complaints",
                        priority="high",
                    ))

        if fresh_notes or newly_breached:
            await db.commit()
            for note in fresh_notes:
                await db.refresh(note)
                await push_notification(note)
            logger.info(f"Complaint SLA checked: {newly_breached} newly breached, {len(fresh_notes)} notifications")
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def complaint_sla_loop() -> None:
    interval_seconds = settings.COMPLAINT_SLA_CHECK_INTERVAL_SECONDS
    logger.info(f"Complaint SLA loop starting (interval: {interval_seconds}s)")

    while True:
        try:
            await check_complaint_sla()
        except Exception as e:
            logger.error(f"Complaint SLA job failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)
