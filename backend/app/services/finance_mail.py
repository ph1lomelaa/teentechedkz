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
    """Срочные письма по матрице событий (задание 7): по одному на договор,
    после 45 секунд тишины по нему (склейка, не дольше 5 минут). События старше
    суток, которые не успели уйти, идут одним письмом «Пока не было связи…».
    Несрочные события письмом не уходят — они в утренней сводке."""
    from app.services.finance_desk import (
        EMAIL_MAX_AGE_HOURS, EMAIL_MAX_HOLD_SECONDS, EMAIL_QUIET_SECONDS, _email_html, _groups, contract_now,
        contract_number, email_subject, email_text, finance_address, finance_recipients, notion_mismatch,
        recorded_paid, urgent_for, urgent_key,
    )
    from app.models.contract import Contract
    from app.services.finance_desk import finance_mail_recipients
    # Финансисты и на время их отсутствия — заместители (задание 5).
    recipients = [u for u in await finance_mail_recipients(db) if finance_address(u)]
    now_ = datetime.now(timezone.utc)
    since = now_ - timedelta(hours=EMAIL_MAX_AGE_HOURS)
    # Concurrent workers cannot enqueue the same event at once. The unique
    # event/recipient constraint remains the final guard.
    events = (await db.execute(select(FinanceChangeEvent, Student.full_name)
        .join(Student, Student.id == FinanceChangeEvent.student_id)
        .where(FinanceChangeEvent.notified_at.is_not(None), FinanceChangeEvent.emailed_at.is_(None))
        .order_by(FinanceChangeEvent.created_at).limit(500)
        .with_for_update(of=FinanceChangeEvent, skip_locked=True))).all()
    if not events:
        return
    existing = set((await db.execute(select(FinanceMailEvent.event_id, FinanceMailEvent.recipient_id)
        .where(FinanceMailEvent.event_id.in_([e.id for e, _ in events])))).all())
    old = [(e, n) for e, n in events if e.created_at < since]
    fresh = [(e, n) for e, n in events if e.created_at >= since]
    # Склейка: договор, по которому только что были события, ещё ждёт.
    by_contract: dict = {}
    for e, _ in fresh:
        by_contract.setdefault((e.student_id, e.contract_id), []).append(e)
    held = set()
    for key, group_events in by_contract.items():
        newest = max(e.created_at for e in group_events)
        oldest = min(e.created_at for e in group_events)
        if (now_ - newest).total_seconds() < EMAIL_QUIET_SECONDS and (now_ - oldest).total_seconds() < EMAIL_MAX_HOLD_SECONDS:
            held.add(key)
    ready = [(e, n) for e, n in fresh if (e.student_id, e.contract_id) not in held]
    for recipient in recipients:
        urgent = urgent_for(recipient)
        own = [(e, name) for e, name in ready
               if urgent_key(e) in urgent and e.actor_id != recipient.id and (e.id, recipient.id) not in existing]
        for group in await _groups(db, own):
            url = settings.FRONTEND_URL.rstrip('/') + group.link
            contract = await db.get(Contract, group.contract_id) if group.contract_id else None
            group.remaining = contract.client_remaining_amount if contract is not None else None
            if contract is not None:
                group.by_payments = notion_mismatch(contract.amount, contract.client_remaining_amount,
                                                    await recorded_paid(db, contract.id))
            now = contract_now(contract, await contract_number(db, contract))
            delivery = FinanceMailDelivery(recipient_id=recipient.id, recipient=finance_address(recipient),
                student_id=group.student_id, contract_id=group.contract_id, kind='change',
                subject=email_subject(group), body=email_text(group, url, now), html=_email_html(group, url, now))
            db.add(delivery)
            await db.flush()
            for event in group.events:
                db.add(FinanceMailEvent(delivery_id=delivery.id, event_id=event.id, recipient_id=recipient.id))
        # Пока не было связи (воркер стоял, почта лежала) — одно письмо на всё старое срочное.
        backlog = [(e, name) for e, name in old
                   if urgent_key(e) in urgent and e.actor_id != recipient.id and (e.id, recipient.id) not in existing]
        if backlog:
            url = settings.FRONTEND_URL.rstrip('/') + '/finance/review'
            lines = [f"{name}: {_describe(e)}" for e, name in backlog]
            subject = f"Пока не было связи, произошло {len(backlog)} {_changes_word(len(backlog))}"
            text = "\n".join([subject, "", *lines, "", f"Открыть проверку: {url}"])
            delivery = FinanceMailDelivery(recipient_id=recipient.id, recipient=finance_address(recipient), student_id=None,
                kind='backlog', subject=subject, body=text, html=_simple_html(subject, lines, url, 'Открыть проверку'))
            db.add(delivery)
            await db.flush()
            for event, _ in backlog:
                db.add(FinanceMailEvent(delivery_id=delivery.id, event_id=event.id, recipient_id=recipient.id))
    # emailed_at is a legacy dispatch watermark. Delivery outcomes are held in
    # the durable per-recipient journal, including unknown and failed results.
    # Несрочные события тоже помечаются: их место — утренняя сводка.
    for event, _ in old + ready:
        event.emailed_at = now_
    await db.commit()


def _describe(e) -> str:
    from app.services.finance_desk import describe_change
    return describe_change(e)


def _changes_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "изменение"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "изменения"
    return "изменений"


def _simple_html(title: str, lines: list[str], url: str, button: str) -> str:
    from html import escape
    items = "".join(f"<li style='margin:0 0 6px'>{escape(line)}</li>" for line in lines)
    return ("<div style='font-family:Arial,sans-serif;font-size:15px;line-height:1.45;color:#111;max-width:560px'>"
            f"<p style='font-size:18px;font-weight:700;margin:0 0 12px'>{escape(title)}</p>"
            f"<ul style='margin:0 0 16px;padding-left:20px'>{items}</ul>"
            f"<p><a href='{escape(url)}' style='background:#FFD400;color:#111;padding:10px 18px;border-radius:8px;"
            f"text-decoration:none;font-weight:700;display:inline-block'>{escape(button)}</a></p>"
            "<p style='color:#888;font-size:12px'>Письмо из раздела «Финансы» TeenTechEd.</p></div>")


async def notify_failed(db, delivery) -> None:
    """Письмо не доставлено после повторов — колокольчик админам (один раз)."""
    from app.services.notify import notify
    if delivery.failure_notified_at is not None:
        return
    admins = (await db.execute(select(User).where(User.role == UserRole.admin, User.is_active.is_(True)))).scalars().all()
    for admin in admins:
        notify(db, admin.id, kind="finance_mail_failed", title=f"Письмо финансисту не доставлено: {delivery.recipient}",
               body=f"«{delivery.subject}». Проверьте почту для писем в «Настройки → Пользователи».",
               link="/settings/users", priority="high")
    delivery.failure_notified_at = datetime.now(timezone.utc)


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
            await notify_failed(db, delivery)
            await db.commit()
            continue
        recipient = await db.get(User, delivery.recipient_id) if delivery.recipient_id else None
        # Админ получает сводку по подписке и письма как заместитель финансиста.
        allowed = (UserRole.finance_manager, UserRole.admin)
        if recipient is None or not recipient.is_active or recipient.role not in allowed or finance_address(recipient) != delivery.recipient:
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
            if delivery.status == 'failed':
                await notify_failed(db, delivery)
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
