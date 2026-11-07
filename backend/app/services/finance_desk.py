"""Кабинет финансиста: статусы платежей по графику и журнал изменений из Notion.

Статус строки графика считается, а не хранится (см. app/models/finance.py).
Функции статуса и сроков — чистые, чтобы их можно было проверять без базы;
всё, что ходит в базу, лежит ниже и только собирает для них данные.
"""
from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import Contract
from app.models.finance import FinanceChangeEvent, FinanceChangeStatus, PaymentScheduleItem
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.student import Student
from app.models.user import User, UserRole
from app.services.notify import notify, was_sent


class ItemState(str, enum.Enum):
    paid = "paid"
    overdue = "overdue"
    today = "today"
    upcoming = "upcoming"


def item_state(*, amount: Decimal, paid: Decimal, due: date, today: date) -> ItemState:
    """Оплаченная строка закрыта, даже если срок прошёл; частичная оплата
    строку не закрывает — остаток всё ещё ждём или уже просрочили."""
    if paid >= amount:
        return ItemState.paid
    if due < today:
        return ItemState.overdue
    if due == today:
        return ItemState.today
    return ItemState.upcoming


def aging_bucket(days_overdue: int) -> str:
    """Те же границы, что на старой странице «Финансы»: 0-30, 31-60, 60+."""
    if days_overdue <= 30:
        return "b30"
    if days_overdue <= 60:
        return "b60"
    return "b61"


# Денежные поля, о правке которых в Notion узнаёт финансист. Первая группа
# приходит через синк полей (Notion → договор), вторая есть только в снимке
# пайплайна — в договор не переносится, из платформы не правится. Формулы
# Notion (TBP, TOTAL (Company), себестоимость) не отслеживаются: они меняются
# сами вслед за полями ниже, и каждая правка давала бы по три уведомления.
SYNCED_FIELDS = frozenset({
    "client_fee", "client_remaining", "client_remaining_date", "pipeline_status",
    "english_sum", "english_paid", "mentor_total",
})
SNAPSHOT_FIELDS = frozenset({"up_sum", "up_paid", "proforientation_sum", "ielts_exam_fee", "mentor_paid"})
# Оплаты, внесённые не в разделе «Финансы» (старая страница /payments).
PLATFORM_FIELDS = frozenset({"payment_added", "payment_changed"})
WATCHED_FIELDS = SYNCED_FIELDS | SNAPSHOT_FIELDS | PLATFORM_FIELDS
_DATE_FIELDS = frozenset({"client_remaining_date"})

FIELD_LABELS = {
    "client_fee": "Сумма договора",
    "client_remaining": "Остаток клиента",
    "client_remaining_date": "Дата оплаты",
    "pipeline_status": "Статус договора",
    "english_sum": "Английский: сумма",
    "english_paid": "Английский: оплачено",
    "mentor_total": "Менторам всего",
    "up_sum": "УП: сумма",
    "up_paid": "УП: оплачено",
    "proforientation_sum": "Профориентация",
    "ielts_exam_fee": "Экзамен IELTS",
    "mentor_paid": "Менторам выплачено",
    "payment_added": "Оплата внесена",
    "payment_changed": "Оплата изменена",
}

_STATUS_LABELS = {
    "active_work": "Активная работа", "on_visa": "На визе", "paused": "Пауза",
    "completed_admitted": "Работа окончена — поступил", "changed_mind": "Работа окончена — передумали",
    "lost_applicant": "Пропал абитуриент", "refund": "На возврате", "unpaid": "Не оплачено",
    "transferred_pipeline": "Перевели на другой продукт", "ielts_retake": "Пересдача IELTS",
    "reapplication": "Переподача", "problem": "Проблема", "suspended": "Подвешено", "no_status": "Без статуса",
}


def _as_text(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, enum.Enum):
        return str(value.value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    if isinstance(value, (int, float, Decimal)):
        return _money_text(value)
    return str(value)[:200]


def _money_text(value: Any) -> str | None:
    """Деньги в журнал — без хвостов: 800000, а не 800000.00 и не 8e5."""
    try:
        d = Decimal(str(value).replace(" ", "").replace(",", "."))
    except Exception:
        return str(value)[:200]
    return format(d.normalize(), "f") if d == d.to_integral() else format(d, "f")


def _canon(field: str, value: Any) -> str | None:
    text = _as_text(value)
    if text is None or field in _DATE_FIELDS or field == "pipeline_status":
        return text
    return _money_text(text)


def should_record(field: str, old: Any, new: Any) -> bool:
    """Записывать ли правку: денежное поле и значение действительно сменилось
    (100000 и «100 000.00» — одно и то же)."""
    return field in WATCHED_FIELDS and _canon(field, old) != _canon(field, new)


def format_value(field: str, value: str | None) -> str:
    if value is None:
        return "пусто"
    if field in _DATE_FIELDS:
        try:
            return date.fromisoformat(value).strftime("%d.%m.%Y")
        except ValueError:
            return value
    if field == "pipeline_status":
        return _STATUS_LABELS.get(value, value)
    try:
        return f"{Decimal(value):,.0f} ₸".replace(",", "\u00a0")
    except Exception:
        return value


async def finance_recipients(db: AsyncSession) -> list[User]:
    """Кому слать: все активные финансисты. Пока роли ни у кого нет — админам,
    иначе изменения копились бы в журнале, о котором никто не знает."""
    rows = (await db.execute(
        select(User).where(User.role == UserRole.finance_manager, User.is_active.is_(True))
    )).scalars().all()
    if rows:
        return list(rows)
    return list((await db.execute(
        select(User).where(User.role == UserRole.admin, User.is_active.is_(True))
    )).scalars().all())


async def record_change(
    db: AsyncSession, *, student: Student, contract: Contract | None, field: str, old: Any, new: Any,
    source: str = "notion", actor: User | None = None, source_ref: str | None = None,
) -> FinanceChangeEvent | None:
    """Записать правку денег в журнал. Без commit и без уведомления: запись
    едет в транзакции самой правки, а уведомление и письмо собирает
    notify_pending / email_pending — одно на договор.

    Все правки сохраняются для аудита. Собственные события исключаются
    отдельно для каждого получателя при доставке.
    """
    if not should_record(field, old, new):
        return None
    if source_ref is not None:
        existing = (await db.execute(
            select(FinanceChangeEvent).where(FinanceChangeEvent.source_ref == source_ref)
        )).scalar_one_or_none()
        if existing is not None:
            return existing
    event = FinanceChangeEvent(
        student_id=student.id,
        contract_id=contract.id if contract is not None else None,
        field=field,
        old_value=_canon(field, old),
        new_value=_canon(field, new),
        source=source,
        actor_id=actor.id if actor is not None else None,
        source_ref=source_ref,
    )
    db.add(event)
    await db.flush()
    return event


async def record_notion_change(
    db: AsyncSession, *, student: Student, contract: Contract | None, field: str, old: Any, new: Any,
    source_ref: str | None = None,
) -> FinanceChangeEvent | None:
    """Правка, пришедшая синком из Notion."""
    return await record_change(db, student=student, contract=contract, field=field, old=old, new=new,
                               source="notion", source_ref=source_ref)


async def record_payment_change(
    db: AsyncSession, *, payment: Payment, actor: User, old_amount: Any = None, created: bool = False,
) -> FinanceChangeEvent | None:
    """Оплату клиента внесли или поправили не в разделе «Финансы» (старая
    страница оплат). Значение — сумма; дата и способ — в подписи поля."""
    if payment.type is not PaymentType.client_payment:
        return None
    contract = await db.get(Contract, payment.contract_id)
    student = await db.get(Student, contract.student_id) if contract else None
    if student is None:
        return None
    return await record_change(
        db, student=student, contract=contract, field="payment_added" if created else "payment_changed",
        old=None if created else old_amount, new=payment.amount, source="platform", actor=actor,
    )


async def record_snapshot_changes(
    db: AsyncSession, *, snapshot: Any, old_row: dict, new_row: dict, edited_at: datetime | None,
) -> list[FinanceChangeEvent]:
    """Денежные поля, которых нет в синке полей: сравниваем старый и новый
    снимок строки пайплайна. Только для привязанных к ученику страниц."""
    if not snapshot.student_id or not old_row:
        return []
    student = await db.get(Student, snapshot.student_id)
    if student is None:
        return []
    contract = (await db.execute(
        select(Contract).where(Contract.student_id == student.id).order_by(Contract.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    edited = edited_at.isoformat() if edited_at else ""
    events = []
    for field in sorted(SNAPSHOT_FIELDS):
        event = await record_notion_change(
            db, student=student, contract=contract, field=field,
            old=old_row.get(field), new=new_row.get(field),
            source_ref=f"snapshot:{snapshot.notion_page_id}:{edited}:{field}",
        )
        if event is not None:
            events.append(event)
    return events


async def _students_with_queued_sync(db: AsyncSession, student_ids: set[uuid.UUID]) -> set[uuid.UUID]:
    from app.models.notion_field_sync import FieldSyncStatus, NotionFieldSync

    if not student_ids:
        return set()
    return set((await db.execute(
        select(NotionFieldSync.student_id).where(
            NotionFieldSync.student_id.in_(student_ids),
            NotionFieldSync.status.in_((FieldSyncStatus.pending, FieldSyncStatus.processing)),
        )
    )).scalars().all())


@dataclass
class ChangeGroup:
    """Правки одного договора, собранные в одно уведомление и одно письмо."""
    student_id: uuid.UUID
    contract_id: uuid.UUID | None
    student_name: str
    events: list[FinanceChangeEvent]
    actors: dict[uuid.UUID, str]
    notion_page: str | None = None

    @property
    def lines(self) -> list[str]:
        out = []
        for e in self.events:
            who = f" ({self.actors[e.actor_id]})" if e.actor_id in self.actors else ""
            out.append(f"{FIELD_LABELS.get(e.field, e.field)}: {format_value(e.field, e.old_value)} → "
                       f"{format_value(e.field, e.new_value)}{who}")
        return out

    @property
    def where(self) -> str:
        sources = {e.source for e in self.events}
        if sources == {"notion"}:
            return "в Notion"
        names = sorted({self.actors[e.actor_id] for e in self.events if e.actor_id in self.actors})
        return f"в платформе ({', '.join(names)})" if names and sources == {"platform"} else "в платформе"

    @property
    def title(self) -> str:
        if len(self.events) == 1:
            return f"{self.student_name}: изменение {self.where} · {FIELD_LABELS.get(self.events[0].field, self.events[0].field)}"
        return f"{self.student_name}: {_changes_word(len(self.events))} {self.where}"

    @property
    def link(self) -> str:
        return f"/finance/contracts/{self.contract_id}" if self.contract_id else "/finance/review"

    @property
    def notion_url(self) -> str | None:
        """Страница ученика в Notion: из снимка ученика, иначе из «snapshot:<page_id>:…»."""
        if self.notion_page:
            return self.notion_page
        for e in self.events:
            ref = e.source_ref or ""
            if ref.startswith("snapshot:"):
                page = ref.split(":")[1].replace("-", "")
                if page:
                    return f"https://www.notion.so/{page}"
        return None


async def _groups(db: AsyncSession, events: list[tuple[FinanceChangeEvent, str]]) -> list[ChangeGroup]:
    """Сгруппировать по договору. Ученик, у которого в очереди синка ещё лежат
    правки, ждёт следующего прохода — иначе одна синхронизация давала бы два
    уведомления."""
    waiting = await _students_with_queued_sync(db, {e.student_id for e, _ in events})
    actor_ids = {e.actor_id for e, _ in events if e.actor_id}
    actors = {u.id: u.name for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars()} if actor_ids else {}
    groups: dict[tuple, ChangeGroup] = {}
    for event, name in events:
        if event.student_id in waiting:
            continue
        key = (event.student_id, event.contract_id)
        if key not in groups:
            groups[key] = ChangeGroup(event.student_id, event.contract_id, name, [], actors)
        groups[key].events.append(event)
    if groups:
        from app.models.notion_snapshot import NotionSnapshot
        pages = dict((await db.execute(select(NotionSnapshot.student_id, NotionSnapshot.notion_url).where(
            NotionSnapshot.student_id.in_({g.student_id for g in groups.values()}),
            NotionSnapshot.notion_url.is_not(None)))).all())
        for group in groups.values():
            group.notion_page = pages.get(group.student_id)
    return list(groups.values())


@dataclass
class Outbox:
    """Что отправить после commit: колокольчик уже записан, это доставка."""
    notifications: list = None
    recipients: set = None
    contract_ids: set = None


async def notify_pending(db: AsyncSession) -> Outbox:
    """Создать уведомления в колокольчике по ещё не разосланным записям.
    Одно на договор, автору правки — не шлём. Без commit."""
    out = Outbox([], set(), set())
    events = (await db.execute(
        select(FinanceChangeEvent, Student.full_name)
        .join(Student, Student.id == FinanceChangeEvent.student_id)
        .where(FinanceChangeEvent.notified_at.is_(None))
        .order_by(FinanceChangeEvent.created_at.asc())
    )).all()
    if not events:
        return out
    groups = await _groups(db, events)
    if not groups:
        return out
    recipients = await finance_recipients(db)
    now = datetime.now(timezone.utc)
    for group in groups:
        for user in recipients:
            # Data invalidation also reaches the author; the bell does not.
            out.recipients.add(user.id)
            visible_events = [e for e in group.events if e.actor_id != user.id]
            if not visible_events:
                continue
            visible = ChangeGroup(group.student_id, group.contract_id, group.student_name, visible_events, group.actors)
            body = "\n".join(visible.lines)
            out.notifications.append(notify(db, user.id, kind="finance_change", title=visible.title, body=body,
                                            link=visible.link, priority="high"))
            out.recipients.add(user.id)
        if group.contract_id:
            out.contract_ids.add(group.contract_id)
        for e in group.events:
            e.notified_at = now
    return out


async def flush_notifications(db: AsyncSession) -> int:
    """notify_pending + commit, затем доставка: WebSocket (колокольчик и
    страницы раздела обновляются сразу). Доставка — после commit и без
    гарантий: колокольчик и журнал уже записаны. В Telegram финансы не пишут."""
    out = await notify_pending(db)
    await db.commit()
    if out.notifications or out.recipients:
        from app.services.notify import push_notification, push_ws

        for note in out.notifications:
            await push_notification(note)
        if out.recipients:
            await push_ws(list(out.recipients), "finance.changed",
                          {"contract_ids": [str(c) for c in out.contract_ids]})
    return len(out.notifications)


# --------------------------------------------------------------------------- письма


EMAIL_MAX_AGE_HOURS = 24


# Письмом — только то, что касается денег клиента. Выплаты менторам,
# профориентация и экзамен видны в кабинете на «Проверке», но не шлются.
EMAIL_FIELDS = frozenset({"client_fee", "client_remaining", "client_remaining_date", "pipeline_status",
                          "english_paid", "up_paid", "payment_added", "payment_changed"})


def _num(value: str | None) -> Decimal | None:
    try:
        return Decimal(value) if value is not None else None
    except Exception:
        return None


def _money(value: Decimal) -> str:
    return format_value("client_fee", str(value))


def describe_change(e: FinanceChangeEvent) -> str:
    """Одно изменение — одной фразой, без названий полей Notion."""
    old, new = format_value(e.field, e.old_value), format_value(e.field, e.new_value)
    if e.field == "client_remaining":
        a, b = _num(e.old_value), _num(e.new_value)
        if a is not None and b is not None and b < a:
            return f"Остаток уменьшился на {_money(a - b)}: {old} → {new}. Похоже на оплату {_money(a - b)}"
        if a is not None and b is not None and b > a:
            return f"Остаток увеличился на {_money(b - a)}: {old} → {new}"
        return f"Указан остаток {new}" if a is None else f"Остаток очищен (был {old})"
    if e.field == "client_remaining_date":
        if e.old_value is None:
            return f"Назначена дата оплаты {new}"
        return f"Дата оплаты перенесена: {old} → {new}" if e.new_value else f"Дата оплаты снята (была {old})"
    if e.field == "payment_added":
        return f"Внесена оплата {new}"
    if e.field == "payment_changed":
        return f"Изменена оплата: {old} → {new}"
    if e.field == "client_fee":
        return f"Изменилась сумма договора: {old} → {new}"
    if e.field == "pipeline_status":
        return f"Статус договора: {old} → {new}"
    return f"{FIELD_LABELS.get(e.field, e.field)}: {old} → {new}"


def next_steps(group: ChangeGroup) -> list[str]:
    fields = {e.field for e in group.events}
    steps = []
    paid = any(e.field == "client_remaining" and (_num(e.new_value) or 0) < (_num(e.old_value) or 0) for e in group.events)
    if paid or fields & {"payment_added", "payment_changed", "english_paid", "up_paid"}:
        steps.append("Проверьте поступление денег и отметьте оплату в кабинете.")
    if "client_remaining_date" in fields:
        steps.append("Проверьте, нужно ли сдвинуть график платежей.")
    if fields & {"client_fee", "pipeline_status"} or ("client_remaining" in fields and not paid):
        steps.append("Сверьте договор и график платежей.")
    return steps


def _short_name(name: str) -> str:
    parts = name.split()
    return f"{parts[0]} {parts[1][0]}." if len(parts) > 1 and parts[1] else name


def _who(group: ChangeGroup) -> str:
    names = sorted({group.actors[e.actor_id] for e in group.events if e.actor_id in group.actors})
    if names:
        return ", ".join(names) + (", в Notion" if {e.source for e in group.events} == {"notion"} else "")
    return "в Notion" if {e.source for e in group.events} == {"notion"} else "в платформе"


def email_subject(group: ChangeGroup) -> str:
    """«Кенес Е. — остаток уменьшился на 200 000 ₸»: суть видна в списке писем."""
    if len(group.events) == 1:
        head = describe_change(group.events[0]).split(":")[0].split(". ")[0]
        return f"{_short_name(group.student_name)} — {head[0].lower() + head[1:]}"
    return f"{_short_name(group.student_name)} — {_changes_word(len(group.events))} по деньгам"


def contract_now(contract) -> list[tuple[str, str]]:
    """Блок «Сейчас по договору»: только заполненные значения."""
    if contract is None:
        return []
    rows = []
    if contract.amount is not None:
        rows.append(("Договор", _money(contract.amount)))
    if contract.amount is not None and contract.client_remaining_amount is not None:
        rows.append(("Оплачено", _money(contract.amount - contract.client_remaining_amount)))
    if contract.client_remaining_amount is not None:
        rows.append(("Остаток", _money(contract.client_remaining_amount)))
    if contract.client_remaining_amount and contract.client_remaining_date:
        rows.append(("Следующий платёж", f"{_money(contract.client_remaining_amount)} до {contract.client_remaining_date.strftime('%d.%m.%Y')}"))
    if contract.client_remaining_amount is None:
        rows.append(("Остаток", "в Notion не заполнен"))
    return rows


def changed_at(group: ChangeGroup) -> str:
    from zoneinfo import ZoneInfo
    latest = max(e.created_at for e in group.events if e.created_at) if any(e.created_at for e in group.events) else datetime.now(timezone.utc)
    return latest.astimezone(ZoneInfo("Asia/Almaty")).strftime("%d.%m.%Y %H:%M")


def email_text(group: ChangeGroup, url: str, now: list[tuple[str, str]]) -> str:
    lines = [group.student_name, "", *(f"• {describe_change(e)}" for e in group.events),
             f"Кто изменил: {_who(group)} · {changed_at(group)} (Алматы)"]
    steps = next_steps(group)
    if steps:
        lines += ["", "Что сделать:", *steps]
    if now:
        lines += ["", "Сейчас по договору:", *(f"{label}: {value}" for label, value in now)]
    links = [f"Открыть договор: {url}"] + ([f"Открыть в Notion: {group.notion_url}"] if group.notion_url else [])
    return "\n".join([*lines, "", *links])


def _email_html(group: ChangeGroup, url: str, now: list[tuple[str, str]] | None = None) -> str:
    from html import escape

    changes = "".join(f"<li style='margin:0 0 6px'>{escape(describe_change(e))}</li>" for e in group.events)
    steps = next_steps(group)
    state = "".join(f"<tr><td style='padding:3px 16px 3px 0;color:#666'>{escape(label)}</td><td style='padding:3px 0'>{escape(value)}</td></tr>"
                    for label, value in (now or []))
    button = "padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block"
    return (
        "<div style='font-family:Arial,sans-serif;font-size:15px;line-height:1.45;color:#111;max-width:560px'>"
        f"<p style='font-size:18px;font-weight:700;margin:0 0 12px'>{escape(group.student_name)}</p>"
        f"<ul style='margin:0 0 8px;padding-left:20px;font-size:16px'>{changes}</ul>"
        f"<p style='margin:0 0 16px;color:#666;font-size:13px'>Кто изменил: {escape(_who(group))} · {escape(changed_at(group))} (Алматы)</p>"
        + (f"<div style='margin:0 0 16px;padding:10px 14px;background:#FFF8D6;border-left:3px solid #FFD400'>"
           f"<b>Что сделать</b><br>{'<br>'.join(escape(x) for x in steps)}</div>" if steps else "")
        + (f"<p style='margin:0 0 4px;font-weight:700'>Сейчас по договору</p><table style='border-collapse:collapse;margin:0 0 20px'>{state}</table>" if state else "")
        + f"<p style='margin:0 0 20px'><a href='{escape(url)}' style='background:#FFD400;color:#111;{button}'>Открыть договор</a>"
        + (f" <a href='{escape(group.notion_url)}' style='margin-left:8px;border:1px solid #111;color:#111;{button}'>Открыть в Notion</a>" if group.notion_url else "")
        + "</p><p style='color:#888;font-size:12px'>Письмо из раздела «Финансы» TeenTechEd.</p></div>"
    )


async def email_pending(db: AsyncSession) -> int:
    from app.services.finance_mail import email_pending as deliver
    return await deliver(db)


async def finance_notify_loop() -> None:
    """Раз в 15 секунд: уведомления и письма по правкам денег. Отдельно от
    синка Notion — правки внутри платформы не должны ждать его прохода."""
    import asyncio
    import logging

    from app.core.database import AsyncSessionLocal

    log = logging.getLogger(__name__)
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await flush_notifications(db)
            async with AsyncSessionLocal() as db:
                await email_pending(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("finance notify loop failed; will retry")
        await asyncio.sleep(15)


# --------------------------------------------------------------------------- выборки


@dataclass
class ItemRow:
    item: PaymentScheduleItem
    paid: Decimal
    state: ItemState
    student_name: str
    mzk_name: str | None
    pipeline_status: str | None
    # Последняя оплата по строке: способ и дата. Чек — есть ли у каждой оплаты
    # строки приложенный документ.
    method: str | None = None
    paid_at: date | None = None
    has_receipt: bool = True


async def payment_info(db: AsyncSession, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    from app.models.document import Document

    if not item_ids:
        return {}
    rows = (await db.execute(
        select(Payment.schedule_item_id, Payment.amount, Payment.method, Payment.paid_at, Payment.id)
        .where(
            Payment.schedule_item_id.in_(item_ids),
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
        .order_by(Payment.paid_at.asc())
    )).all()
    with_doc = set((await db.execute(
        select(Document.payment_id).where(Document.payment_id.in_([r.id for r in rows]))
    )).scalars().all()) if rows else set()
    info: dict[uuid.UUID, dict] = {}
    for item_id, amount, method, paid_at, payment_id in rows:
        entry = info.setdefault(item_id, {"paid": Decimal("0"), "method": None, "paid_at": None, "has_receipt": True})
        entry["paid"] += amount or Decimal("0")
        entry["method"] = method.value if method else entry["method"]
        entry["paid_at"] = paid_at or entry["paid_at"]
        entry["has_receipt"] = entry["has_receipt"] and payment_id in with_doc
    return info


async def paid_by_item(db: AsyncSession, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    if not item_ids:
        return {}
    rows = (await db.execute(
        select(Payment.schedule_item_id, func.sum(Payment.amount))
        .where(
            Payment.schedule_item_id.in_(item_ids),
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
        .group_by(Payment.schedule_item_id)
    )).all()
    return {item_id: total or Decimal("0") for item_id, total in rows}


async def load_items(
    db: AsyncSession, *, today: date, where: list | None = None, contract_id: uuid.UUID | None = None,
) -> list[ItemRow]:
    stmt = (
        select(PaymentScheduleItem, Student.full_name, User.name, Contract.pipeline_status)
        .join(Student, Student.id == PaymentScheduleItem.student_id)
        .join(Contract, Contract.id == PaymentScheduleItem.contract_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False))
        .order_by(PaymentScheduleItem.due_date.asc(), Student.full_name.asc())
    )
    for cond in where or []:
        stmt = stmt.where(cond)
    if contract_id is not None:
        stmt = stmt.where(PaymentScheduleItem.contract_id == contract_id)
    rows = (await db.execute(stmt)).all()
    info = await payment_info(db, [r[0].id for r in rows])
    out = []
    for item, student_name, mzk_name, pipeline in rows:
        i = info.get(item.id, {})
        p = i.get("paid", Decimal("0"))
        out.append(ItemRow(
            item=item, paid=p,
            state=item_state(amount=item.amount, paid=p, due=item.due_date, today=today),
            student_name=student_name, mzk_name=mzk_name,
            pipeline_status=pipeline.value if pipeline else None,
            method=i.get("method"), paid_at=i.get("paid_at"), has_receipt=i.get("has_receipt", True),
        ))
    return out


def item_to_dict(row: ItemRow, today: date) -> dict:
    item = row.item
    return {
        "id": str(item.id),
        "contract_id": str(item.contract_id),
        "student_id": str(item.student_id),
        "student_name": row.student_name,
        "mzk_name": row.mzk_name,
        "pipeline_status": row.pipeline_status,
        "kind": item.kind.value,
        "label": item.label,
        "amount": str(item.amount),
        "paid": str(row.paid),
        "left": str(max(item.amount - row.paid, Decimal("0"))),
        "currency": item.currency,
        "due_date": item.due_date.isoformat(),
        "state": row.state.value,
        "days_overdue": (today - item.due_date).days if row.state is ItemState.overdue else 0,
        "note": item.note,
        "method": row.method,
        "paid_at": row.paid_at.isoformat() if row.paid_at else None,
        "has_receipt": row.has_receipt if row.paid > 0 else None,
    }


def change_to_dict(event: FinanceChangeEvent, student_name: str, resolver: str | None, mzk_name: str | None = None,
                   actor_name: str | None = None) -> dict:
    return {
        # Где сделана правка — «Notion» или «Платформа (Имя)»: бухгалтеру важно, кого спросить.
        "where": "Notion" if event.source == "notion" and not actor_name else
                 (f"Notion, перенесла вручную {actor_name}" if event.source == "notion" else
                  f"Платформа · {actor_name}" if actor_name else "Платформа"),
        "id": str(event.id),
        "student_id": str(event.student_id),
        "student_name": student_name,
        "mzk_name": mzk_name,
        "field_label": FIELD_LABELS.get(event.field, event.field),
        "old_label": format_value(event.field, event.old_value),
        "new_label": format_value(event.field, event.new_value),
        "notified": event.notified_at is not None,
        "contract_id": str(event.contract_id) if event.contract_id else None,
        "field": event.field,
        "old_value": event.old_value,
        "new_value": event.new_value,
        "source": event.source,
        "status": event.status.value,
        "schedule_item_id": str(event.schedule_item_id) if event.schedule_item_id else None,
        "resolved_by": resolver,
        "resolved_at": event.resolved_at.isoformat() if event.resolved_at else None,
        "created_at": event.created_at.isoformat(),
    }


async def apply_accepted_change(
    db: AsyncSession, event: FinanceChangeEvent, *, user: User, today: date, move_schedule: bool = False,
) -> PaymentScheduleItem | None:
    """«Подтвердить»: правка проверена. Для даты оплаты — по выбору
    бухгалтера ещё и передвинуть ожидаемый платёж.

    Двигаем неоплаченную строку со старой датой; если такой нет — ближайшую
    неоплаченную по договору. Для сумм и статусов график не трогаем: «Остаток
    клиента» в Notion — итог по договору, а не один платёж, и делить его на
    строки за бухгалтера нельзя.
    """
    moved = None
    if move_schedule and event.field == "client_remaining_date" and event.contract_id and event.new_value:
        new_due = date.fromisoformat(event.new_value)
        rows = await load_items(db, today=today, contract_id=event.contract_id)
        open_rows = [r for r in rows if r.state is not ItemState.paid]
        target = next((r for r in open_rows if event.old_value and r.item.due_date.isoformat() == event.old_value), None)
        if target is None and open_rows:
            target = open_rows[0]
        if target is not None:
            target.item.due_date = new_due
            moved = target.item
    event.status = FinanceChangeStatus.accepted
    event.schedule_item_id = moved.id if moved else None
    event.resolved_by = user.id
    event.resolved_at = datetime.now(timezone.utc)
    return moved


async def notify_due_today(db: AsyncSession, today: date) -> int:
    """Утреннее «сегодня ждём N оплат». Раз в день на финансиста: цикл
    напоминаний крутится каждые несколько часов, а дата в тексте — ключ
    повтора для was_sent."""
    rows = [r for r in await load_items(db, today=today, where=[PaymentScheduleItem.due_date == today])
            if r.state is ItemState.today]
    if not rows:
        return 0
    left = sum((r.item.amount - r.paid for r in rows), Decimal("0"))
    stamp = today.strftime("%d.%m.%Y")
    sent = 0
    for user in await finance_recipients(db):
        if await was_sent(db, user.id, kind="finance_due_today", body_contains=stamp):
            continue
        notify(db, user.id, kind="finance_due_today",
               title=f"Сегодня ждём {len(rows)} {_payments_word(len(rows))} на {left:,.0f} ₸".replace(",", "\u00a0"),
               body=f"Оплаты по графику на {stamp}", link="/finance", priority="high")
        sent += 1
    return sent


def _changes_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} изменение"
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return f"{n} изменения"
    return f"{n} изменений"


def _payments_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "оплату"
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return "оплаты"
    return "оплат"


# --------------------------------------------------------------------------- остаток и Notion


async def platform_paid(db: AsyncSession, contract_id: uuid.UUID) -> Decimal:
    total = (await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.contract_id == contract_id,
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
    )).scalar_one()
    return Decimal(total or 0)


async def next_open_due(db: AsyncSession, contract_id: uuid.UUID, today: date) -> date | None:
    rows = await load_items(db, today=today, contract_id=contract_id)
    open_rows = [r for r in rows if r.state is not ItemState.paid]
    return open_rows[0].item.due_date if open_rows else None


async def sync_contract_to_notion(
    db: AsyncSession, contract: Contract, *, today: date, user: User, paid_now: Decimal | None = None,
) -> dict:
    """Привести «Остаток клиента» и его дату в договоре к графику и отправить в Notion.

    Остаток — одно число в договоре, синхронизированное с Notion. Оплата в
    платформе уменьшает его на сумму оплаты (решение 01.11.2026: иначе МЗК в
    Notion не видят оплату, а «Оплачено» у старых договоров было бы нулём).
    Дата — срок ближайшего неоплаченного платежа графика; если всё оплачено —
    дата пустая. В Notion правка уходит штатной очередью синка полей.
    Без commit.
    """
    from app.core.audit import log_change
    from app.services.notion_sync import enqueue_crm_field_edits

    old_remaining = contract.client_remaining_amount
    old_date = contract.client_remaining_date
    if paid_now is not None:
        paid_before = await platform_paid(db, contract.id) - paid_now
        from app.services import contract_finance

        base = contract_finance.client_remaining(contract.amount, paid_before, manual_remaining=old_remaining)
        if base is not None:
            contract.client_remaining_amount = max(base - paid_now, Decimal("0"))
    remaining = contract.client_remaining_amount
    due = await next_open_due(db, contract.id, today)
    if due is not None or (remaining is not None and remaining <= 0):
        contract.client_remaining_date = due
    changed = {}
    if contract.client_remaining_amount != old_remaining:
        changed["client_remaining"] = old_remaining
        await log_change(db, "contract", contract.id, "client_remaining_amount",
                         str(old_remaining) if old_remaining is not None else None,
                         str(contract.client_remaining_amount), str(user.id), "finance")
    if contract.client_remaining_date != old_date:
        changed["client_remaining_date"] = old_date
        await log_change(db, "contract", contract.id, "client_remaining_date",
                         old_date.isoformat() if old_date else None,
                         contract.client_remaining_date.isoformat() if contract.client_remaining_date else None,
                         str(user.id), "finance")
    await db.flush()
    state = {"state": "unchanged"}
    if changed:
        student = await db.get(Student, contract.student_id)
        state = await enqueue_crm_field_edits(db, student, changed, contract_id=contract.id)
    return state


IMPORT_SKIP_STATUSES = frozenset({"refund"})


async def notion_import_candidates(db: AsyncSession) -> list[tuple[Contract, Student, Decimal]]:
    """Договоры, у которых в Notion есть остаток с датой, а графика ещё нет.

    Из них на старте делается первый платёж графика — иначе в день запуска
    раздел пуст. Договор на возврате не берём: деньги там не ждут.
    """
    from app.services import contract_finance

    rows = (await db.execute(
        select(Contract, Student)
        .join(Student, Student.id == Contract.student_id)
        .where(
            Student.is_archived.is_(False),
            Contract.client_remaining_date.is_not(None),
            ~Contract.id.in_(select(PaymentScheduleItem.contract_id)),
        )
    )).all()
    out = []
    for contract, student in rows:
        if contract.pipeline_status and contract.pipeline_status.value in IMPORT_SKIP_STATUSES:
            continue
        remaining = contract_finance.client_remaining(
            contract.amount, await platform_paid(db, contract.id), manual_remaining=contract.client_remaining_amount)
        if remaining is not None and remaining > 0:
            out.append((contract, student, remaining))
    return out
