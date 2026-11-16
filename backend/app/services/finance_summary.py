"""Утренняя сводка финансиста и контроль свежести данных Notion (задание 7).

Сводка — одно письмо и один колокольчик в рабочий день в выбранный час по
Алматы (по умолчанию 9:00). Заменяет прежнее «Сегодня ждём N оплат». Блоки:
ждём сегодня, новая просрочка, офферы за сутки, изменения за сутки, не сходится
с Notion. Пустые блоки не показываются; если пусто всё — письма нет.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from html import escape
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.contract import Contract
from app.models.finance import FinanceChangeEvent, PaymentScheduleItem
from app.models.finance_mail import FinanceMailDelivery
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.student import Student
from app.models.user import User, UserRole
from app.services import finance_desk
from app.services.notify import notify, was_sent

ALMATY = ZoneInfo("Asia/Almaty")
DEFAULT_HOUR = 9


def prefs_of(user: User) -> dict:
    """Настройки писем с умолчаниями: все срочные из матрицы, сводка в 9:00,
    финансисту сводка включена, админу — только если подписался."""
    raw = user.finance_prefs or {}
    return {
        "urgent": sorted(finance_desk.urgent_for(user)),
        "summary_hour": int(raw.get("summary_hour", DEFAULT_HOUR)),
        # Решение 15.11: сводка по умолчанию выключена — главное срочные письма.
        "summary": bool(raw.get("summary", False)),
    }


def _money(value: Decimal) -> str:
    return f"{value:,.0f} ₸".replace(",", " ")


def _payments_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "оплату"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "оплаты"
    return "оплат"


async def build_summary(db: AsyncSession, today: date) -> dict | None:
    """Содержимое сводки на день или None, если писать не о чем."""
    since = datetime.combine(today - timedelta(days=1), datetime.min.time(), tzinfo=ALMATY).replace(hour=9)
    rows = await finance_desk.load_items(db, today=today, where=[PaymentScheduleItem.due_date <= today])
    due_today = [r for r in rows if r.state is finance_desk.ItemState.today]
    # Новая просрочка: срок был вчера (или в выходные, если сегодня понедельник).
    lookback = 3 if today.weekday() == 0 else 1
    new_overdue = [r for r in rows if r.state is finance_desk.ItemState.overdue
                   and r.item.due_date is not None and (today - r.item.due_date).days <= lookback]
    overdue_all = [r for r in rows if r.state is finance_desk.ItemState.overdue]
    events = (await db.execute(
        select(FinanceChangeEvent, Student.full_name, User.name)
        .join(Student, Student.id == FinanceChangeEvent.student_id)
        .outerjoin(User, User.id == FinanceChangeEvent.actor_id)
        .where(FinanceChangeEvent.created_at >= since)
        .order_by(FinanceChangeEvent.created_at)
    )).all()
    offers = [(e, n) for e, n, _ in events if e.field == finance_desk.OFFER_FIELD]
    changes = [(e, n, who) for e, n, who in events if e.field not in finance_desk.EVENT_FIELDS]
    contracts = (await db.execute(
        select(Contract).join(Student, Student.id == Contract.student_id)
        .where(Student.is_archived.is_(False), Contract.amount.is_not(None),
               Contract.client_remaining_amount.is_not(None), Contract.client_remaining_amount > 0)
    )).scalars().all()
    paid = dict((await db.execute(
        select(Payment.contract_id, func.sum(Payment.amount))
        .where(Payment.contract_id.in_([c.id for c in contracts]), Payment.type == PaymentType.client_payment,
               Payment.status == PaymentStatus.paid).group_by(Payment.contract_id)
    )).all()) if contracts else {}
    mismatches = sum(1 for c in contracts
                     if finance_desk.notion_mismatch(c.amount, c.client_remaining_amount, paid.get(c.id) or Decimal("0")) is not None)

    blocks = []
    if due_today:
        total = sum((r.item.amount - r.paid for r in due_today), Decimal("0"))
        blocks.append(("Ждём сегодня", [f"{r.student_name}: {_money(r.item.amount - r.paid)}" for r in due_today],
                       f"{len(due_today)} {_payments_word(len(due_today))} на {_money(total)}"))
    if new_overdue:
        blocks.append(("Новая просрочка", [f"{r.student_name}: {_money(r.item.amount - r.paid)}, срок {r.item.due_date:%d.%m.%Y}" for r in new_overdue], None))
    if offers:
        blocks.append(("Офферы за сутки", [f"{n}: {e.new_value}" for e, n in offers], None))
    if changes:
        lines = []
        for e, n, who in changes:
            src = who or ("Notion" if e.source == "notion" else "платформа")
            lines.append(f"{n}: {finance_desk.FIELD_LABELS.get(e.field, e.field)} "
                         f"{finance_desk.format_value(e.field, e.old_value)} → {finance_desk.format_value(e.field, e.new_value)} ({src})")
        blocks.append(("Изменения за сутки", lines, None))
    if mismatches:
        blocks.append(("Не сходится с Notion", [f"Договоров, где в Notion остаток больше, чем по оплатам: {mismatches}"], None))
    if not blocks:
        return None
    subject = (f"Финансы на {today:%d.%m}: ждём {len(due_today)} {_payments_word(len(due_today))}, "
               f"просрочено {len(overdue_all)}, изменений {len(changes)}")
    return {"subject": subject, "blocks": blocks}


def summary_text(summary: dict, url: str) -> str:
    out = [summary["subject"], ""]
    for title, lines, meta in summary["blocks"]:
        out.append(f"{title}{': ' + meta if meta else ''}")
        out += [f"  {line}" for line in lines]
        out.append("")
    return "\n".join([*out, f"Открыть платежи: {url}"])


def summary_html(summary: dict, url: str) -> str:
    parts = ["<div style='font-family:Arial,sans-serif;font-size:15px;line-height:1.45;color:#111;max-width:600px'>",
             f"<p style='font-size:18px;font-weight:700;margin:0 0 16px'>{escape(summary['subject'])}</p>"]
    for title, lines, meta in summary["blocks"]:
        parts.append(f"<p style='margin:0 0 4px;font-weight:700'>{escape(title)}"
                     + (f" <span style='font-weight:400;color:#666'>· {escape(meta)}</span>" if meta else "") + "</p>")
        parts.append("<ul style='margin:0 0 14px;padding-left:20px'>"
                     + "".join(f"<li style='margin:0 0 4px'>{escape(line)}</li>" for line in lines) + "</ul>")
    parts.append(f"<p><a href='{escape(url)}' style='background:#FFD400;color:#111;padding:10px 18px;border-radius:8px;"
                 "text-decoration:none;font-weight:700;display:inline-block'>Открыть платежи</a></p>"
                 "<p style='color:#888;font-size:12px'>Письмо из раздела «Финансы» TeenTechEd.</p></div>")
    return "".join(parts)


async def send_morning_summary(db: AsyncSession, now: datetime | None = None) -> int:
    """В рабочий день, начиная с часа сводки получателя: письмо (если почта
    включена) и колокольчик. Один раз в день на человека. Без commit."""
    now = (now or datetime.now(timezone.utc)).astimezone(ALMATY)
    today = now.date()
    if today.weekday() >= 5:
        return 0
    users = (await db.execute(select(User).where(
        User.is_active.is_(True), User.role.in_((UserRole.finance_manager, UserRole.admin))))).scalars().all()
    # На время отсутствия финансиста сводку получает его заместитель (задание 5).
    deputies = {d.id for d in await finance_desk.finance_mail_recipients(db, today)}
    users = [u for u in users if not (u.role == UserRole.finance_manager and finance_desk.is_away(u, today))]
    due = [u for u in users if (prefs_of(u)["summary"] or u.id in deputies) and now.hour >= prefs_of(u)["summary_hour"]]
    if not due:
        return 0
    stamp = f"[summary:{today.isoformat()}]"
    summary = None
    sent = 0
    for user in due:
        if await was_sent(db, user.id, kind="finance_summary", body_contains=stamp):
            continue
        if summary is None:
            summary = await build_summary(db, today)
            if summary is None:
                return 0
        url = settings.FRONTEND_URL.rstrip("/") + "/finance"
        notify(db, user.id, kind="finance_summary", title=summary["subject"],
               body=f"{'; '.join(t for t, _, _ in summary['blocks'])}. {stamp}", link="/finance", priority="normal")
        address = finance_desk.finance_address(user)
        if address and settings.FINANCE_EMAIL_NOTIFICATIONS:
            db.add(FinanceMailDelivery(recipient_id=user.id, recipient=address, student_id=None, kind="summary",
                                       subject=summary["subject"], body=summary_text(summary, url),
                                       html=summary_html(summary, url)))
        sent += 1
    return sent


async def notion_fresh_at(db: AsyncSession) -> datetime | None:
    """Когда данные Notion в последний раз точно обновились: последний
    успешный полный или быстрый проход синка. Через сессию вызывающего."""
    from app.models.background_job import BackgroundJob

    return (await db.execute(select(func.max(BackgroundJob.finished_at)).where(
        BackgroundJob.kind.in_(("notion_sync_status", "notion_quick_sync")), BackgroundJob.status == "done",
    ))).scalar_one_or_none()


async def check_notion_stale(db: AsyncSession, now: datetime | None = None) -> bool:
    """Синк Notion молчит больше 30 минут — колокольчик админам (раз в час)."""
    from app.services import notion_sync

    if not notion_sync.is_configured():
        return False
    now = now or datetime.now(timezone.utc)
    fresh = await notion_fresh_at(db)
    if fresh is not None and now - fresh < timedelta(minutes=30):
        return False
    mark = f"[notion-stale:{now.astimezone(ALMATY):%Y-%m-%dT%H}]"
    admins = (await db.execute(select(User).where(User.role == UserRole.admin, User.is_active.is_(True)))).scalars().all()
    when = fresh.astimezone(ALMATY).strftime("%d.%m.%Y %H:%M") if fresh else "ещё ни разу"
    for admin in admins:
        if await was_sent(db, admin.id, kind="notion_stale", body_contains=mark):
            continue
        notify(db, admin.id, kind="notion_stale", title="Синхронизация с Notion не работает больше 30 минут",
               body=f"Последние данные из Notion: {when}. Финансист видит устаревшие суммы. {mark}",
               link="/finances", priority="high")
    return True
