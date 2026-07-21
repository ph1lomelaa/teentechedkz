"""Background job to send payment due notifications."""
import asyncio
import logging
from datetime import date, timedelta, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.contract import Contract
from app.models.notification import Notification
from app.models.student import Student

logger = logging.getLogger(__name__)


async def check_upcoming_payments(db: AsyncSession) -> None:
    """
    Scan for contracts with client_remaining_date approaching within N days.
    Create notifications for students and their assigned mentors.
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

    if not contracts:
        return

    for contract in contracts:
        student = await db.get(Student, contract.student_id)
        if not student or not student.user_id:
            continue

        days_until_due = (contract.client_remaining_date - date.today()).days

        # Notification for student
        db.add(
            Notification(
                user_id=student.user_id,
                kind="payment_due",
                title=f"Платеж должен быть произведен в течение {days_until_due} дней",
                body=f"Оставшаяся сумма: {contract.client_remaining_amount} {contract.currency}. "
                     f"Срок платежа: {contract.client_remaining_date.strftime('%d.%m.%Y')}",
                link="/portal/profile",
                priority="high" if days_until_due <= 3 else "normal",
            )
        )

        # Notification for assigned mentor
        if student.lead_mentor_id:
            db.add(
                Notification(
                    user_id=student.lead_mentor_id,
                    kind="payment_due",
                    title=f"{student.full_name}: платеж должен быть в течение {days_until_due} дней",
                    body=f"Оставшаяся сумма: {contract.client_remaining_amount} {contract.currency}. "
                         f"Срок: {contract.client_remaining_date.strftime('%d.%m.%Y')}",
                    link=f"/workspace/students/{student.id}",
                    priority="normal",
                )
            )

    await db.commit()
    logger.info(f"Payment notifications created for {len(contracts)} contracts")


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
