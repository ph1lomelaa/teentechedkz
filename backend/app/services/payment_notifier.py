"""Background job to send payment due notifications."""
import asyncio
import logging
from datetime import date, timedelta, datetime, timezone

from sqlalchemy import select, and_

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.contract import Contract
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.notification import Notification
from app.models.notion_snapshot import NotionSnapshot, NotionMatchStatus
from app.models.student import Student
from app.models.user import User

logger = logging.getLogger(__name__)


async def _already_notified_today(db: AsyncSession, user_id, link: str) -> bool:
    """Не дублировать одно и то же уведомление при каждом прогоне джобы (раз в N часов)."""
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await db.execute(
        select(Notification.id).where(
            and_(
                Notification.user_id == user_id,
                Notification.link == link,
                Notification.created_at >= start_of_day,
            )
        ).limit(1)
    )
    return result.scalar() is not None


async def _lead_mentor_id(db: AsyncSession, student_id) -> "uuid.UUID | None":
    result = await db.execute(
        select(MentorAssignment.mentor_id).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.role == MentorRole.lead,
            MentorAssignment.is_active.is_(True),
        ).limit(1)
    )
    return result.scalar()


async def _notify_due_payment(
    db: AsyncSession,
    student: Student,
    remaining_amount,
    currency: str,
    due_date: date,
    mzk_manager_id=None,
    source: str = "crm",
) -> None:
    days_until_due = (due_date - date.today()).days
    link_student = "/portal/profile"
    link_workspace = f"/workspace/students/{student.id}"
    source_note = "" if source == "crm" else " (данные из Notion)"

    if student.user_id and not await _already_notified_today(db, student.user_id, link_student):
        db.add(
            Notification(
                user_id=student.user_id,
                kind="payment_due",
                title=f"Платеж должен быть произведен в течение {days_until_due} дней",
                body=f"Оставшаяся сумма: {remaining_amount} {currency}. "
                     f"Срок платежа: {due_date.strftime('%d.%m.%Y')}{source_note}",
                link=link_student,
                priority="high" if days_until_due <= 3 else "normal",
            )
        )

    lead_mentor_id = await _lead_mentor_id(db, student.id)
    if lead_mentor_id and not await _already_notified_today(db, lead_mentor_id, link_workspace):
        db.add(
            Notification(
                user_id=lead_mentor_id,
                kind="payment_due",
                title=f"{student.full_name}: платеж должен быть в течение {days_until_due} дней",
                body=f"Оставшаяся сумма: {remaining_amount} {currency}. "
                     f"Срок: {due_date.strftime('%d.%m.%Y')}{source_note}",
                link=link_workspace,
                priority="normal",
            )
        )

    if mzk_manager_id and not await _already_notified_today(db, mzk_manager_id, link_workspace):
        db.add(
            Notification(
                user_id=mzk_manager_id,
                kind="payment_due",
                title=f"{student.full_name}: платеж должен быть в течение {days_until_due} дней",
                body=f"Оставшаяся сумма: {remaining_amount} {currency}. "
                     f"Срок: {due_date.strftime('%d.%m.%Y')}{source_note}",
                link=link_workspace,
                priority="normal",
            )
        )

    # Broadcast a 'risk' notification to all admins and MZK managers
    try:
        users_result = await db.execute(select(User.id).where(User.role.in_(["admin", "mzk_manager"])))
        admin_ids = [r[0] for r in users_result.fetchall()]
        risk_link = link_workspace
        for uid in admin_ids:
            if await _already_notified_today(db, uid, risk_link):
                continue
            db.add(
                Notification(
                    user_id=uid,
                    kind="risk",
                    title=f"Риск: {student.full_name} — платеж до {due_date.strftime('%d.%m.%Y')}",
                    body=f"Остаток: {remaining_amount} {currency}{source_note}",
                    link=risk_link,
                    priority="normal",
                )
            )
    except Exception:
        # Don't fail the whole job if notification broadcast fails
        logger.exception("Failed to broadcast risk notifications")


async def check_upcoming_payments(db: AsyncSession) -> None:
    """
    Scan for contracts (and, as a fallback, linked Notion snapshots) with a
    remaining-payment date approaching within N days. Create notifications
    for the student, their lead mentor, the MZK manager and admins (risk feed).
    """
    look_ahead_days = settings.PAYMENT_DUE_LOOK_AHEAD_DAYS
    threshold_date = date.today() + timedelta(days=look_ahead_days)

    result = await db.execute(
        select(Contract)
        .join(Student, Contract.student_id == Student.id)
        .where(
            Contract.client_remaining_date.isnot(None),
            Contract.client_remaining_date <= threshold_date,
            Contract.client_remaining_date >= date.today(),
        )
    )
    contracts = list(result.scalars())
    notified_student_ids: set = set()

    for contract in contracts:
        student = await db.get(Student, contract.student_id)
        if not student:
            continue
        notified_student_ids.add(student.id)
        await _notify_due_payment(
            db,
            student,
            contract.client_remaining_amount,
            contract.currency,
            contract.client_remaining_date,
            mzk_manager_id=contract.mzk_manager_id,
            source="crm",
        )

    # Fallback: linked Notion snapshots that carry a real due date/remaining
    # amount but whose CRM contract has no client_remaining_date filled in yet.
    snap_result = await db.execute(
        select(NotionSnapshot).where(
            NotionSnapshot.status == NotionMatchStatus.linked,
            NotionSnapshot.student_id.isnot(None),
        )
    )
    for snapshot in snap_result.scalars():
        if snapshot.student_id in notified_student_ids:
            continue
        d = snapshot.normalized_data or {}
        raw_date = d.get("client_remaining_date")
        raw_amount = d.get("client_remaining")
        if not raw_date or not raw_amount:
            continue
        try:
            due_date = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00")).date()
        except ValueError:
            continue
        if not (date.today() <= due_date <= threshold_date):
            continue
        try:
            remaining = float(str(raw_amount).replace(" ", "").replace(",", "."))
        except (TypeError, ValueError):
            continue
        if remaining <= 0:
            continue
        student = await db.get(Student, snapshot.student_id)
        if not student:
            continue
        notified_student_ids.add(student.id)
        await _notify_due_payment(db, student, remaining, "KZT", due_date, source="notion")

    if notified_student_ids:
        await db.commit()
        logger.info(f"Payment notifications checked for {len(notified_student_ids)} students")


async def payment_notifier_loop() -> None:
    """Background loop: run check_upcoming_payments every N hours."""
    interval_seconds = settings.PAYMENT_NOTIFICATION_INTERVAL_SECONDS
    logger.info(f"Payment notifier loop starting (interval: {interval_seconds}s)")

    while True:
        try:
            async with AsyncSessionLocal() as db:
                await check_upcoming_payments(db)
        except Exception as e:
            logger.error(f"Payment notifier job failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)

