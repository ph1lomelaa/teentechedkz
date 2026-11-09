"""Reserve before SMTP; ambiguous outcomes require explicit reconciliation."""
import smtplib
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, update
from app.core.config import settings
from app.models.finance import FinanceChangeEvent
from app.models.finance_mail import FinanceMailDelivery, FinanceMailEvent
from app.models.student import Student
from app.models.user import User, UserRole
from app.services import mailer


def failure_status(error):
    # Only errors proving that DATA was not accepted may be retried.
    if isinstance(error, (ConnectionRefusedError, smtplib.SMTPConnectError)):
        return 'pending'
    if isinstance(error, smtplib.SMTPRecipientsRefused):
        return 'pending' if all(400 <= v[0] < 500 for v in error.recipients.values()) else 'failed'
    if isinstance(error, smtplib.SMTPResponseException):
        return 'pending' if 400 <= error.smtp_code < 500 else 'failed'
    return 'unknown'


async def enqueue(db):
    from app.services.finance_desk import finance_address, finance_recipients, _groups, _email_html, EMAIL_MAX_AGE_HOURS, contract_now, email_subject, email_text, EMAIL_FIELDS
    from app.models.contract import Contract
    recipients = [u for u in await finance_recipients(db) if u.role == UserRole.finance_manager and finance_address(u)]
    if not recipients:
        return
    since = datetime.now(timezone.utc) - timedelta(hours=EMAIL_MAX_AGE_HOURS)
    # Concurrent workers cannot enqueue the same event at once. The unique
    # event/recipient constraint remains the final guard.
    events = (await db.execute(select(FinanceChangeEvent, Student.full_name)
        .join(Student, Student.id == FinanceChangeEvent.student_id)
        .where(FinanceChangeEvent.notified_at.is_not(None), FinanceChangeEvent.emailed_at.is_(None),
               FinanceChangeEvent.created_at >= since)
        .order_by(FinanceChangeEvent.created_at).limit(500)
        .with_for_update(of=FinanceChangeEvent, skip_locked=True))).all()
    if not events:
        return
    existing = set((await db.execute(select(FinanceMailEvent.event_id, FinanceMailEvent.recipient_id)
        .where(FinanceMailEvent.event_id.in_([e.id for e, _ in events])))).all())
    for recipient in recipients:
        own = [(e, name) for e, name in events if e.field in EMAIL_FIELDS and e.actor_id != recipient.id and (e.id, recipient.id) not in existing]
        for group in await _groups(db, own):
            url = settings.FRONTEND_URL.rstrip('/') + group.link
            now = contract_now(await db.get(Contract, group.contract_id) if group.contract_id else None)
            delivery = FinanceMailDelivery(recipient_id=recipient.id, recipient=finance_address(recipient),
                student_id=group.student_id, contract_id=group.contract_id,
                subject=email_subject(group), body=email_text(group, url, now), html=_email_html(group, url, now))
            db.add(delivery)
            await db.flush()
            for event in group.events:
                db.add(FinanceMailEvent(delivery_id=delivery.id, event_id=event.id, recipient_id=recipient.id))
    # emailed_at is a legacy dispatch watermark. Delivery outcomes are held in
    # the durable per-recipient journal, including unknown and failed results.
    for event, _ in events:
        event.emailed_at = datetime.now(timezone.utc)
    await db.commit()


async def dispatch(db):
    from app.services.finance_desk import finance_address
    now = datetime.now(timezone.utc)
    await db.execute(update(FinanceMailDelivery).where(FinanceMailDelivery.status == 'sending',
        FinanceMailDelivery.claimed_at < now - timedelta(minutes=5)).values(status='unknown',
        last_error='Процесс отправки прерван; проверьте корпоративный ящик'))
    await db.commit()
    sent = 0
    # Bound each pass; claims are committed before the external effect.
    for _ in range(50):
        delivery = (await db.execute(select(FinanceMailDelivery).where(
            FinanceMailDelivery.status == 'pending', FinanceMailDelivery.next_attempt_at <= datetime.now(timezone.utc))
            .order_by(FinanceMailDelivery.created_at).limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
        if delivery is None:
            break
        if delivery.expires_at < datetime.now(timezone.utc):
            delivery.status = 'failed'
            delivery.last_error = 'Истёк срок автоматических попыток (24 часа)'
            await db.commit()
            continue
        recipient = await db.get(User, delivery.recipient_id) if delivery.recipient_id else None
        if recipient is None or not recipient.is_active or recipient.role != UserRole.finance_manager or finance_address(recipient) != delivery.recipient:
            delivery.status = 'failed'
            delivery.last_error = 'Получатель или его права изменились; отправка остановлена'
            await db.commit()
            continue
        delivery.status = 'sending'
        delivery.claimed_at = datetime.now(timezone.utc)
        delivery.attempts += 1
        await db.commit()
        try:
            await mailer.send_mail(to=[delivery.recipient], subject=delivery.subject, text=delivery.body, html=delivery.html)
        except Exception as error:
            delivery.status = failure_status(error)
            # Do not persist SMTP responses containing addresses or credentials.
            delivery.last_error = type(error).__name__
            delivery.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=min(900, 60 * 2 ** min(delivery.attempts - 1, 4)))
        else:
            delivery.status = 'sent'
            delivery.finished_at = datetime.now(timezone.utc)
            delivery.last_error = None
            sent += 1
        await db.commit()
    return sent


async def email_pending(db):
    if not settings.FINANCE_EMAIL_NOTIFICATIONS or not mailer.is_configured():
        return 0
    await enqueue(db)
    return await dispatch(db)
