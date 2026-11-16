"""Кабинет финансиста: статусы платежей по графику и журнал изменений из Notion.

Статус строки графика считается, а не хранится (см. app/models/finance.py).
Функции статуса и сроков — чистые, чтобы их можно было проверять без базы;
всё, что ходит в базу, лежит ниже и только собирает для них данные.
"""
from __future__ import annotations

import enum
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contract import Contract
from app.models.finance import FinanceChangeEvent, FinanceChangeStatus, PaymentAllocation, PaymentScheduleItem, ScheduleKind
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.student import Student
from app.models.user import User, UserRole
from app.services.notify import notify, was_sent


class ItemState(str, enum.Enum):
    cancelled = "cancelled"
    # Строка «после оффера» без даты: оффера ещё нет, ничего не ждём.
    after_offer = "after_offer"
    paid = "paid"
    overdue = "overdue"
    today = "today"
    upcoming = "upcoming"


def item_state(*, amount: Decimal, paid: Decimal, due: date | None, today: date) -> ItemState:
    """Оплаченная строка закрыта, даже если срок прошёл; частичная оплата
    строку не закрывает — остаток всё ещё ждём или уже просрочили."""
    if paid >= amount:
        return ItemState.paid
    if due is None:
        return ItemState.after_offer
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
# С 12.11.2026 (миграция 138) эти поля есть и в договоре, с обменом в обе
# стороны. Финансист по-прежнему узнаёт о правке в Notion по снимку строки —
# сразу, без ожидания согласования; обмен полями для них уведомление не пишет,
# чтобы не было двух уведомлений об одной правке.
SNAPSHOT_FIELDS = frozenset({"up_sum", "up_paid", "proforientation_sum", "ielts_exam_fee", "mentor_paid"})
# Оплаты, внесённые не в разделе «Финансы» (старая страница /payments).
PLATFORM_FIELDS = frozenset({"payment_added", "payment_changed"})
# Оффер отмечен в заявке ученика: остаток по договору платится после оффера,
# и финансист должен узнать, что пора его выставлять. Значение — «вуз, страна».
OFFER_FIELD = "offer_received"
# Оффер сняли (статус заявки вернули назад или заявку удалили): остаток
# выставлять рано. Значение — тот же «вуз, страна».
OFFER_CANCEL_FIELD = "offer_cancelled"
# Возврат (задание 9): запрошен, согласован, выплачен. Значение — сумма.
REFUND_REQUESTED = "refund_requested"
REFUND_APPROVED = "refund_approved"
REFUND_PAID = "refund_paid"
REFUND_FIELDS = frozenset({REFUND_REQUESTED, REFUND_APPROVED, REFUND_PAID})
EVENT_FIELDS = frozenset({OFFER_FIELD, OFFER_CANCEL_FIELD}) | REFUND_FIELDS
WATCHED_FIELDS = SYNCED_FIELDS | SNAPSHOT_FIELDS | PLATFORM_FIELDS | EVENT_FIELDS
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
    "offer_received": "Оффер получен",
    "offer_cancelled": "Оффер отменён",
    "refund_requested": "Запрошен возврат",
    "refund_approved": "Возврат согласован",
    "refund_paid": "Возврат выплачен",
}

# Роль автора правки в письме и колокольчике: «Отметил: Имя Фамилия, ментор».
ROLE_LABELS = {
    UserRole.admin: "админ",
    UserRole.mzk_manager: "МЗК",
    UserRole.academic_head: "академический руководитель",
    UserRole.finance_manager: "финансист",
    UserRole.mentor: "ментор",
    UserRole.student: "ученик",
}


def actor_label(user: User) -> str:
    role = ROLE_LABELS.get(user.role)
    return f"{user.name}, {role}" if role else user.name


_STATUS_LABELS = {
    "active_work": "Активная работа", "on_visa": "На визе", "paused": "Пауза",
    "completed_admitted": "Работа окончена: поступил", "changed_mind": "Работа окончена: передумали",
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
    if text is None or field in _DATE_FIELDS or field == "pipeline_status" or field in EVENT_FIELDS:
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
    if field in EVENT_FIELDS:
        return value
    try:
        return f"{Decimal(value):,.0f} ₸".replace(",", "\u00a0")
    except Exception:
        return value


def finance_address(user: User) -> str | None:
    """Куда слать письма финансисту: почта для писем из заявки, иначе почта входа."""
    return (user.notification_email or user.email or None) if user else None


def is_away(user: User, day: date | None = None) -> bool:
    """«Нет на месте с … по …» в настройках писем финансиста (задание 5)."""
    prefs = user.finance_prefs or {}
    start, end = prefs.get("away_from"), prefs.get("away_to")
    if not start or not end:
        return False
    if day is None:
        from zoneinfo import ZoneInfo
        day = datetime.now(ZoneInfo("Asia/Almaty")).date()
    return date.fromisoformat(start) <= day <= date.fromisoformat(end)


async def finance_mail_recipients(db: AsyncSession, day: date | None = None) -> list[User]:
    """Финансисты, а на время их отсутствия — заместители (админ или другой
    финансист). Без запасного «админам, если финансистов нет»."""
    rows = (await db.execute(
        select(User).where(User.role == UserRole.finance_manager, User.is_active.is_(True))
    )).scalars().all()
    out: list[User] = []
    for user in rows:
        target = user
        deputy_id = (user.finance_prefs or {}).get("deputy_id")
        if deputy_id and is_away(user, day):
            deputy = await db.get(User, uuid.UUID(deputy_id))
            if deputy is not None and deputy.is_active and deputy.role in (UserRole.admin, UserRole.finance_manager):
                target = deputy
        if target not in out:
            out.append(target)
    return out


async def finance_recipients(db: AsyncSession) -> list[User]:
    """Кому слать: все активные финансисты (на время отсутствия — их
    заместители). Пока роли ни у кого нет — админам, иначе изменения
    копились бы в журнале, о котором никто не знает."""
    rows = await finance_mail_recipients(db)
    if rows:
        return rows
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


def _offer_refs(application_id) -> tuple[str, str]:
    """source_ref событий оффера одной заявки: первое — «offer:<id>» (так
    записаны все прежние), следующие — «offer:<id>:<метка>»."""
    return f"offer:{application_id}", f"offer:{application_id}:%"


async def _last_offer_event(db: AsyncSession, application_id) -> FinanceChangeEvent | None:
    first, rest = _offer_refs(application_id)
    return (await db.execute(
        select(FinanceChangeEvent)
        .where((FinanceChangeEvent.source_ref == first) | FinanceChangeEvent.source_ref.like(rest))
        .order_by(FinanceChangeEvent.created_at.desc()).limit(1)
    )).scalar_one_or_none()


async def _other_active_offer(db: AsyncSession, application) -> bool:
    """Есть ли у ученика другая заявка в оффере, о которой финансист уже знает.
    Тогда следующий оффер или отмена одного из них денег не меняют: остаток
    выставляется после первого оффера, повторное письмо не нужно."""
    from app.models.application import Application
    from app.services.admission_guard import GUARDED_STATUSES

    others = (await db.execute(
        select(Application.id).where(
            Application.student_id == application.student_id,
            Application.id != application.id,
            Application.submission_status.in_(GUARDED_STATUSES),
        )
    )).scalars().all()
    for other_id in others:
        last = await _last_offer_event(db, other_id)
        if last is not None and last.field == OFFER_FIELD:
            return True
    return False


async def record_offer(
    db: AsyncSession, application, *, actor: User | None, old_status, deleted: bool = False,
) -> FinanceChangeEvent | None:
    """Оффер по заявке поставили или сняли — сообщить финансисту.

    Поставили (вход в оффер или сразу зачисление): «Оффер получен», если по
    этой заявке финансист ещё не знает об оффере. Сняли (статус вернули назад
    или заявку удалили) после «Оффер получен»: «Оффер отменён». Снять и
    поставить снова — снова «Оффер получен»: финансист уже прочитала отмену.

    Несколько офферов у ученика: письмо и колокольчик только о первом.
    Остальные (и отмена одного из нескольких) пишутся в историю договора
    без письма. Без commit: едет в транзакции самой правки заявки.
    """
    from app.models.application import SubmissionStatus
    from app.services.admission_guard import GUARDED_STATUSES, needs_portal_check

    new_status = None if deleted else application.submission_status
    entering = needs_portal_check(old_status, new_status)
    leaving = old_status in GUARDED_STATUSES and new_status not in GUARDED_STATUSES
    if not entering and not leaving:
        return None
    last = await _last_offer_event(db, application.id)
    if entering and last is not None and last.field == OFFER_FIELD:
        return None
    if leaving and (last is None or last.field != OFFER_FIELD):
        return None
    student = await db.get(Student, application.student_id)
    if student is None:
        return None
    contract = await db.get(Contract, application.contract_id) if application.contract_id else None
    if contract is None:
        contract = (await db.execute(
            select(Contract).where(Contract.student_id == student.id)
            .order_by(Contract.created_at.desc()).limit(1)
        )).scalar_one_or_none()
    where = ", ".join(x for x in (application.university, application.country) if x)
    if entering and application.submission_status == SubmissionStatus.enrolled:
        where = f"{where} (сразу зачисление)" if where else "сразу зачисление"
    first, _ = _offer_refs(application.id)
    ref = first if last is None else f"{first}:{uuid.uuid4().hex[:12]}"
    event = await record_change(
        db, student=student, contract=contract, field=OFFER_FIELD if entering else OFFER_CANCEL_FIELD,
        old=None, new=where or "вуз не указан", source="platform", actor=actor, source_ref=ref,
    )
    if entering:
        from zoneinfo import ZoneInfo
        await set_after_offer_due(db, contract, datetime.now(ZoneInfo("Asia/Almaty")).date())
    if event is not None and await _other_active_offer(db, application):
        # Только строка в истории договора: письма и колокольчика нет.
        now = datetime.now(timezone.utc)
        event.notified_at = now
        event.emailed_at = now
    elif event is not None and entering:
        await _notify_offer_team(db, student, contract, where or "вуз не указан", actor)
    return event


async def _notify_offer_team(db: AsyncSession, student: Student, contract: Contract | None, where: str,
                             actor: User | None) -> None:
    """Колокольчик об оффере МЗК договора и академ-хедам (15.11.2026): они
    тоже следят за офферами. Письмо — только финансисту. Тот, кто отметил,
    себе колокольчик не получает."""
    from zoneinfo import ZoneInfo

    from app.core.config import settings
    from app.services.notify import notify

    ids = {u for u in (await db.execute(select(User.id).where(
        User.role == UserRole.academic_head, User.is_active.is_(True)))).scalars()}
    if contract is not None and contract.mzk_manager_id:
        mzk = await db.get(User, contract.mzk_manager_id)
        if mzk is not None and mzk.is_active:
            ids.add(mzk.id)
    if actor is not None:
        ids.discard(actor.id)
    if not ids:
        return
    remaining = contract.client_remaining_amount if contract is not None else None
    due = datetime.now(ZoneInfo("Asia/Almaty")).date() + timedelta(days=settings.FINANCE_AFTER_OFFER_DAYS)
    tail = (f" Остаток {_money(remaining)} к оплате до {due:%d.%m.%Y}." if remaining and remaining > 0
            else " Остатка по договору нет." if remaining is not None else " Остаток в Notion не заполнен.")
    who = f" Отметил: {actor_label(actor)}." if actor is not None else ""
    for uid in ids:
        notify(db, uid, kind="offer_received", title=f"Оффер: {student.full_name} — {where}",
               body=f"{where}.{tail}{who}", link=f"/students/{student.id}", priority="high")


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
    # Остаток по договору на момент письма — для письма об оффере.
    remaining: Decimal | None = None
    # Остаток «по оплатам» (сумма договора минус оплаты в платформе), если
    # в Notion остаток больше: менеджер, похоже, не обновил его после оплаты.
    by_payments: Decimal | None = None

    @property
    def lines(self) -> list[str]:
        out = []
        for e in self.events:
            who = f" ({self.actors[e.actor_id]})" if e.actor_id in self.actors else ""
            if e.field in EVENT_FIELDS:
                out.append(f"{describe_change(e)}{who}")
                continue
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
        if any(e.field == OFFER_FIELD for e in self.events):
            return f"{self.student_name}: оффер получен, пора закрыть остаток"
        if any(e.field == OFFER_CANCEL_FIELD for e in self.events):
            return f"{self.student_name}: оффер отменён"
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


async def attach_notion_urls(db: AsyncSession, rows: list[dict]) -> list[dict]:
    """Ссылка на страницу ученика в Notion для строк списков финансиста
    (из последнего снимка Notion). Нет снимка — notion_url = None."""
    from app.models.notion_snapshot import NotionSnapshot

    ids = {uuid.UUID(r["student_id"]) for r in rows if r.get("student_id")}
    pages = dict((await db.execute(select(NotionSnapshot.student_id, NotionSnapshot.notion_url).where(
        NotionSnapshot.student_id.in_(ids), NotionSnapshot.notion_url.is_not(None)))).all()) if ids else {}
    for r in rows:
        r["notion_url"] = pages.get(uuid.UUID(r["student_id"])) if r.get("student_id") else None
    return rows


async def _groups(db: AsyncSession, events: list[tuple[FinanceChangeEvent, str]]) -> list[ChangeGroup]:
    """Сгруппировать по договору. Ученик, у которого в очереди синка ещё лежат
    правки, ждёт следующего прохода — иначе одна синхронизация давала бы два
    уведомления."""
    waiting = await _students_with_queued_sync(db, {e.student_id for e, _ in events})
    actor_ids = {e.actor_id for e, _ in events if e.actor_id}
    actors = {u.id: actor_label(u) for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars()} if actor_ids else {}
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
    contract_ids = [g.contract_id for g in groups if g.contract_id]
    remaining = dict((await db.execute(
        select(Contract.id, Contract.client_remaining_amount).where(Contract.id.in_(contract_ids))
    )).all()) if contract_ids else {}
    for group in groups:
        for user in recipients:
            # Data invalidation also reaches the author; the bell does not.
            out.recipients.add(user.id)
            visible_events = [e for e in group.events if e.actor_id != user.id]
            if not visible_events:
                continue
            visible = ChangeGroup(group.student_id, group.contract_id, group.student_name, visible_events, group.actors)
            visible.remaining = remaining.get(group.contract_id) if group.contract_id else None
            body = "\n".join(visible.lines)
            # Суть первой строкой — как тема письма («Асель Д.: оффер получен, остаток 600 000 ₸»).
            urgent = any(urgent_key(e) in urgent_for(user) for e in visible_events)
            note = notify(db, user.id, kind="finance_change", title=email_subject(visible), body=body,
                          link=visible.link, priority="high" if urgent else "normal")
            # Время уведомления = время события: в колокольчике и в таблицах одно и то же.
            note.created_at = max((e.created_at for e in visible_events if e.created_at), default=now)
            out.notifications.append(note)
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
# Срочные письма по одному клиенту склеиваются: ждём, пока по договору
# 45 секунд тихо, но не дольше 5 минут от первого события (задание 7).
EMAIL_QUIET_SECONDS = 45
EMAIL_MAX_HOLD_SECONDS = 300

# Матрица событий (задание 7, 14.11): что уходит письмом сразу. Остальное —
# в утреннюю сводку и колокольчик. Ключ — как в настройках финансиста.
URGENT_KEYS = {
    "offer": "Оффер получен",
    "offer_cancelled": "Оффер отменён",
    "client_fee": "Изменилась сумма договора",
    "status": "Статус договора: возврат, пауза, расторжение",
    # Решение 15.11: любая правка денег в Notion — письмом сразу (по умолчанию включено).
    "remaining": "Любая другая правка денег в Notion: остаток, дата оплаты, оплаты английского и УП",
    "refund": "Возврат: запрос и согласование",
}
DEFAULT_URGENT = frozenset({"offer", "offer_cancelled", "client_fee", "status", "remaining", "refund"})
# Статусы договора, о смене на которые финансист узнаёт сразу.
URGENT_STATUSES = frozenset({"refund", "paused", "suspended", "changed_mind", "lost_applicant"})


def urgent_key(e: FinanceChangeEvent) -> str | None:
    """Ключ срочного события или None, если событие — для сводки."""
    if e.field == OFFER_FIELD:
        return "offer"
    if e.field == OFFER_CANCEL_FIELD:
        return "offer_cancelled"
    if e.field == "client_fee":
        return "client_fee"
    if e.field == "pipeline_status" and e.new_value in URGENT_STATUSES:
        return "status"
    if e.field in ("client_remaining", "client_remaining_date", "english_sum", "english_paid", "up_sum", "up_paid",
                   "proforientation_sum", "ielts_exam_fee", "payment_added", "payment_changed"):
        return "remaining"
    if e.field in (REFUND_REQUESTED, REFUND_APPROVED):
        return "refund"
    return None


def urgent_for(user: User | None) -> set[str]:
    """Какие события для этого получателя срочные (по умолчанию — все из матрицы)."""
    prefs = (user.finance_prefs or {}) if user is not None else {}
    chosen = prefs.get("urgent")
    return set(DEFAULT_URGENT) if chosen is None else set(chosen) & set(URGENT_KEYS)


# Письмом — только то, что касается денег клиента. Выплаты менторам,
# профориентация и экзамен видны в кабинете на «Проверке», но не шлются.
EMAIL_FIELDS = frozenset({"client_fee", "client_remaining", "client_remaining_date", "pipeline_status",
                          "english_paid", "up_paid", "payment_added", "payment_changed", OFFER_FIELD,
                          OFFER_CANCEL_FIELD})


def notion_mismatch(amount: Decimal | None, notion_remaining: Decimal | None, recorded_paid: Decimal) -> Decimal | None:
    """Остаток «по оплатам», если в Notion остаток больше него.

    Остаток ведут менеджеры в Notion (решение 14.11), оплаты отмечает
    финансист в платформе. В Notion остаток больше, чем «сумма минус оплаты»,
    значит, после оплаты его не обновили. Обратное (в Notion меньше) — оплаты
    до перехода на платформу, которых в ней нет: это не ошибка.
    """
    from app.core.config import settings
    # Режим «только просмотр» (15.11): оплат в платформе нет — сравнивать не с чем.
    if amount is None or notion_remaining is None or settings.FINANCE_VIEW_ONLY:
        return None
    by_payments = max(amount - recorded_paid, Decimal("0"))
    return by_payments if notion_remaining > by_payments else None


async def recorded_paid(db: AsyncSession, contract_id: uuid.UUID) -> Decimal:
    """Сумма оплат клиента, отмеченных в платформе по договору."""
    total = (await db.execute(
        select(func.sum(Payment.amount)).where(
            Payment.contract_id == contract_id, Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
    )).scalar_one_or_none()
    refunds = (await db.execute(
        select(func.sum(Payment.amount)).where(
            Payment.contract_id == contract_id, Payment.type == PaymentType.client_refund,
            Payment.status == PaymentStatus.paid,
        )
    )).scalar_one_or_none()
    # Возврат клиенту уменьшает «по оплатам» (задание 9).
    return (total or Decimal("0")) - (refunds or Decimal("0"))


async def contract_number(db: AsyncSession, contract: Contract | None) -> str | None:
    """Номер договора для письма: договор TrustMe, привязанный к этому
    договору, иначе единственный непривязанный договор TrustMe ученика.
    Отдельного поля номера пока нет (задание 11)."""
    from app.models.trustme_contract import TrustMeContractLink

    if contract is None:
        return None
    if contract.number:
        return f"№{contract.number.lstrip('№').strip()}"
    links = (await db.execute(
        select(TrustMeContractLink.number).where(
            TrustMeContractLink.financial_contract_id == contract.id,
            TrustMeContractLink.status != 4, TrustMeContractLink.number.is_not(None),
        ).order_by(TrustMeContractLink.linked_at)
    )).scalars().all()
    if not links:
        links = (await db.execute(
            select(TrustMeContractLink.number).where(
                TrustMeContractLink.student_id == contract.student_id,
                TrustMeContractLink.financial_contract_id.is_(None),
                TrustMeContractLink.status != 4, TrustMeContractLink.number.is_not(None),
            )
        )).scalars().all()
        if len(links) != 1:
            return None
    # В TrustMe у копий договоров номер бывает «UPL-UPL-…-№262» — в письме «UPL-№262».
    clean = (re.sub(r"^(UPL-)+", "UPL-", n, flags=re.I).lstrip("№") for n in links)
    return ", ".join(f"№{n}" for n in clean)


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
    if e.field == OFFER_FIELD:
        return f"Получен оффер: {new}" if e.new_value else "Получен оффер"
    if e.field == OFFER_CANCEL_FIELD:
        return f"Оффер отменён: {new}" if e.new_value else "Оффер отменён"
    if e.field in REFUND_FIELDS:
        return f"{FIELD_LABELS[e.field]}: {_money(Decimal(e.new_value))}" if _num(e.new_value) is not None else FIELD_LABELS[e.field]
    return f"{FIELD_LABELS.get(e.field, e.field)}: {old} → {new}"


def next_steps(group: ChangeGroup) -> list[str]:
    from app.core.config import settings
    view_only = settings.FINANCE_VIEW_ONLY
    fields = {e.field for e in group.events}
    steps = []
    if OFFER_FIELD in fields:
        if group.remaining is None:
            steps.append("Остаток по договору не заполнен. Уточните у менеджера, сколько клиент должен после оффера.")
        elif group.remaining > 0:
            offer_at = max((e.created_at for e in group.events if e.field == OFFER_FIELD and e.created_at), default=None)
            if offer_at is not None:
                from zoneinfo import ZoneInfo
                due = offer_at.astimezone(ZoneInfo("Asia/Almaty")).date() + timedelta(days=settings.FINANCE_AFTER_OFFER_DAYS)
                steps.append(f"Свяжитесь с клиентом: остаток {_money(group.remaining)} по договору оплачивается после оффера, "
                             f"срок до {due:%d.%m.%Y}.")
            else:
                steps.append(f"Свяжитесь с клиентом и выставьте остаток {_money(group.remaining)}: по договору он оплачивается после оффера.")
        else:
            steps.append("Остаток по договору 0. Проверьте, что договор оплачен полностью.")
        if group.by_payments is not None and group.remaining is not None:
            steps.append(f"В Notion остаток {_money(group.remaining)}, по оплатам {_money(group.by_payments)}. "
                         "Попросите менеджера обновить остаток в Notion.")
    elif REFUND_REQUESTED in fields:
        steps.append("Проверьте справку по договору: сколько оплачено, что оказано, выплачено ли ментору. Согласует руководитель.")
    elif REFUND_APPROVED in fields:
        steps.append("Выплатите возврат клиенту." if view_only
                     else "Выплатите возврат и отметьте выплату в «Возвратах» с платёжным документом.")
    elif OFFER_CANCEL_FIELD in fields:
        steps.append("Остаток после оффера пока не выставлять. Если уже сообщили клиенту, уточните у ментора.")
    paid = any(e.field == "client_remaining" and (_num(e.new_value) or 0) < (_num(e.old_value) or 0) for e in group.events)
    # Режим «только просмотр» (15.11): финансист в платформе ничего не вносит,
    # поэтому шаги — только сверка с банком и договором.
    if paid or fields & {"payment_added", "payment_changed", "english_paid", "up_paid"}:
        steps.append("Проверьте, что деньги поступили на счёт." if view_only
                     else "Проверьте поступление денег и отметьте оплату в кабинете.")
    if "client_remaining_date" in fields and not view_only:
        steps.append("Проверьте, нужно ли сдвинуть график платежей.")
    if fields & {"client_fee", "pipeline_status"} or ("client_remaining" in fields and not paid):
        steps.append("Сверьте с договором." if view_only else "Сверьте договор и график платежей.")
    return steps


def _short_name(name: str) -> str:
    parts = name.split()
    return f"{parts[0]} {parts[1][0]}." if len(parts) > 1 and parts[1] else name


def _who_label(group: ChangeGroup) -> str:
    """Оффер отмечают, а не «изменяют»: «Отметил: Имя Фамилия, ментор»;
    отмену оффера — «Снял»."""
    fields = {e.field for e in group.events}
    if fields == {OFFER_CANCEL_FIELD}:
        return "Снял"
    return "Отметил" if fields <= EVENT_FIELDS else "Кто изменил"


def _who(group: ChangeGroup) -> str:
    names = sorted({group.actors[e.actor_id] for e in group.events if e.actor_id in group.actors})
    if names:
        return ", ".join(names) + (", в Notion" if {e.source for e in group.events} == {"notion"} else "")
    return "в Notion" if {e.source for e in group.events} == {"notion"} else "в платформе"


def email_subject(group: ChangeGroup) -> str:
    """«Кенес Е.: остаток уменьшился на 200 000 ₸» — суть видна в списке писем.
    В текстах писем длинного тире нет (просьба 14.11)."""
    name = _short_name(group.student_name)
    if any(e.field == OFFER_FIELD for e in group.events):
        tail = "остаток не заполнен" if group.remaining is None else f"остаток {_money(group.remaining)}"
        return f"{name}: оффер получен, {tail}"
    if any(e.field == OFFER_CANCEL_FIELD for e in group.events):
        return f"{name}: оффер отменён"
    if len(group.events) == 1:
        e = group.events[0]
        if e.field in FIELD_LABELS and e.field not in ("client_remaining", "client_remaining_date", "payment_added",
                                                       "payment_changed", "client_fee", "pipeline_status"):
            # «УП: сумма: пусто → 25 000» → «изменилось «УП: сумма»», без «уП».
            return f"{name}: изменилось «{FIELD_LABELS[e.field]}»"
        head = describe_change(e).split(":")[0].split(". ")[0]
        return f"{name}: {head[0].lower() + head[1:] if head[1:2].islower() else head}"
    return f"{name}: {_changes_word(len(group.events))} по деньгам"


def contract_now(contract, number: str | None = None) -> list[tuple[str, str]]:
    """Блок «Сейчас по договору»: только заполненные значения."""
    if contract is None:
        return []
    rows = [("Номер договора", number)] if number else []
    if contract.amount is not None:
        rows.append(("Договор", _money(contract.amount)))
    if contract.amount is not None and contract.client_remaining_amount is not None:
        rows.append(("Оплачено", _money(contract.amount - contract.client_remaining_amount)))
    if contract.client_remaining_amount is not None:
        rows.append(("Остаток", _money(contract.client_remaining_amount)))
    from app.core.config import settings
    # В Notion «Остаток клиента (дата)» одна на всех (15.11) — в режиме «только просмотр» не показываем.
    if contract.client_remaining_amount and contract.client_remaining_date and not settings.FINANCE_VIEW_ONLY:
        rows.append(("Следующий платёж", f"{_money(contract.client_remaining_amount)} до {contract.client_remaining_date.strftime('%d.%m.%Y')}"))
    if contract.client_remaining_amount is None:
        rows.append(("Остаток", "в Notion не заполнен"))
    return rows


def changed_at(group: ChangeGroup) -> str:
    from zoneinfo import ZoneInfo
    latest = max(e.created_at for e in group.events if e.created_at) if any(e.created_at for e in group.events) else datetime.now(timezone.utc)
    return latest.astimezone(ZoneInfo("Asia/Almaty")).strftime("%d.%m.%Y %H:%M")


def email_text(group: ChangeGroup, url: str, now: list[tuple[str, str]]) -> str:
    # Одно изменение — строкой, не списком из одного пункта.
    changes = [describe_change(e) for e in group.events]
    lines = [group.student_name, "", *(changes if len(changes) == 1 else (f"• {c}" for c in changes)),
             f"{_who_label(group)}: {_who(group)} · {changed_at(group)} (Алматы)"]
    steps = next_steps(group)
    if steps:
        lines += ["", "Что сделать:", *steps]
    if now:
        lines += ["", "Сейчас по договору:", *(f"{label}: {value}" for label, value in now)]
    links = [f"Открыть договор: {url}"] + ([f"Открыть в Notion: {group.notion_url}"] if group.notion_url else [])
    return "\n".join([*lines, "", *links])


def _email_html(group: ChangeGroup, url: str, now: list[tuple[str, str]] | None = None) -> str:
    from html import escape

    if len(group.events) == 1:
        changes = f"<p style='margin:0 0 8px;font-size:16px'>{escape(describe_change(group.events[0]))}</p>"
    else:
        items = "".join(f"<li style='margin:0 0 6px'>{escape(describe_change(e))}</li>" for e in group.events)
        changes = f"<ul style='margin:0 0 8px;padding-left:20px;font-size:16px'>{items}</ul>"
    steps = next_steps(group)
    state = "".join(f"<tr><td style='padding:3px 16px 3px 0;color:#666'>{escape(label)}</td><td style='padding:3px 0'>{escape(value)}</td></tr>"
                    for label, value in (now or []))
    button = "padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block"
    return (
        "<div style='font-family:Arial,sans-serif;font-size:15px;line-height:1.45;color:#111;max-width:560px'>"
        f"<p style='font-size:18px;font-weight:700;margin:0 0 12px'>{escape(group.student_name)}</p>"
        f"{changes}"
        f"<p style='margin:0 0 16px;color:#666;font-size:13px'>{_who_label(group)}: {escape(_who(group))} · {escape(changed_at(group))} (Алматы)</p>"
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
    from app.services import finance_summary

    tick = 0
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await flush_notifications(db)
            async with AsyncSessionLocal() as db:
                # Утренняя сводка: раз в день на человека, с его часа (по Алматы).
                if await finance_summary.send_morning_summary(db):
                    await db.commit()
            async with AsyncSessionLocal() as db:
                await email_pending(db)
            if tick % 20 == 0:  # раз в 5 минут
                async with AsyncSessionLocal() as db:
                    await finance_summary.check_notion_stale(db)
                    await db.commit()
                from app.services import finance_debts
                async with AsyncSessionLocal() as db:
                    # Регламент по долгам — раз в день после 10:00 Алматы.
                    await finance_debts.run_daily(db)
                    await db.commit()
            tick += 1
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
        select(PaymentAllocation.schedule_item_id, PaymentAllocation.amount, Payment.method, Payment.paid_at, Payment.id)
        .join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(
            PaymentAllocation.schedule_item_id.in_(item_ids),
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
        select(PaymentAllocation.schedule_item_id, func.sum(PaymentAllocation.amount))
        .join(Payment, Payment.id == PaymentAllocation.payment_id)
        .where(
            PaymentAllocation.schedule_item_id.in_(item_ids),
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
        .group_by(PaymentAllocation.schedule_item_id)
    )).all()
    return {item_id: total or Decimal("0") for item_id, total in rows}


# Строки графика, которые считаются: отменённые остаются только в истории.
ACTIVE_ITEM = PaymentScheduleItem.cancelled_at.is_(None)


async def load_items(
    db: AsyncSession, *, today: date, where: list | None = None, contract_id: uuid.UUID | None = None,
    include_cancelled: bool = False,
) -> list[ItemRow]:
    from app.core.config import settings
    if settings.FINANCE_VIEW_ONLY:
        return await load_notion_items(db, today=today, where=where, contract_id=contract_id)
    stmt = (
        select(PaymentScheduleItem, Student.full_name, User.name, Contract.pipeline_status)
        .join(Student, Student.id == PaymentScheduleItem.student_id)
        .join(Contract, Contract.id == PaymentScheduleItem.contract_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False))
        .order_by(PaymentScheduleItem.due_date.asc().nulls_last(), Student.full_name.asc())
    )
    for cond in where or []:
        stmt = stmt.where(cond)
    if not include_cancelled:
        stmt = stmt.where(ACTIVE_ITEM)
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
            state=ItemState.cancelled if item.cancelled_at else item_state(amount=item.amount, paid=p, due=item.due_date, today=today),
            student_name=student_name, mzk_name=mzk_name,
            pipeline_status=pipeline.value if pipeline else None,
            method=i.get("method"), paid_at=i.get("paid_at"), has_receipt=i.get("has_receipt", True),
        ))
    return out


def _matches(item: PaymentScheduleItem, cond) -> bool:
    """Условия выборки графика (where) для строк из Notion: сравнение срока,
    отбор по договору и по id. Прочие условия к строкам Notion не относятся."""
    import operator as op
    from sqlalchemy.sql import operators as sa_ops

    left, right = getattr(cond, "left", None), getattr(cond, "right", None)
    key = getattr(left, "key", None)
    value = getattr(right, "value", None)
    fn = getattr(cond, "operator", None)
    if key == "due_date":
        if item.due_date is None:
            return False
        table = {sa_ops.eq: op.eq, sa_ops.lt: op.lt, sa_ops.le: op.le, sa_ops.gt: op.gt, sa_ops.ge: op.ge}
        return table[fn](item.due_date, value) if fn in table else True
    if key in ("contract_id", "id"):
        own = getattr(item, key)
        if fn is sa_ops.in_op:
            values = value if isinstance(value, (list, tuple, set)) else getattr(right, "value", None) or []
            return own in set(values)
        if fn is sa_ops.eq:
            return own == value
    return True


# Режим «только просмотр» на данных прода (15.11): точной даты оплаты в Notion
# нет — «Остаток клиента (дата)» одна на всех. Остаток платят после оффера,
# поэтому срок = день оффера + FINANCE_AFTER_OFFER_DAYS. Статусы «На визе» и
# «Поступил» — оффер точно был. Возврат, пауза, передумал, потерян — не долг.
NOTION_NOT_DEBT = frozenset({"refund", "changed_mind", "lost_applicant", "suspended", "paused"})
NOTION_OFFER_STATUSES = frozenset({"on_visa", "completed_admitted"})


async def offer_days(db: AsyncSession, student_ids: set[uuid.UUID]) -> dict[uuid.UUID, date]:
    """День действующего оффера ученика: последняя отметка «Оффер получен»,
    если после неё не было отмены; иначе день перехода в «На визе»/«Поступил»."""
    from zoneinfo import ZoneInfo

    if not student_ids:
        return {}
    almaty = ZoneInfo("Asia/Almaty")
    got: dict[uuid.UUID, datetime] = {}
    cancelled: dict[uuid.UUID, datetime] = {}
    status_at: dict[uuid.UUID, datetime] = {}
    for sid, field, new_value, at in (await db.execute(
        select(FinanceChangeEvent.student_id, FinanceChangeEvent.field, FinanceChangeEvent.new_value, FinanceChangeEvent.created_at)
        .where(FinanceChangeEvent.student_id.in_(student_ids),
               FinanceChangeEvent.field.in_((OFFER_FIELD, OFFER_CANCEL_FIELD, "pipeline_status")))
    )).all():
        if field == OFFER_FIELD:
            got[sid] = max(got.get(sid, at), at)
        elif field == OFFER_CANCEL_FIELD:
            cancelled[sid] = max(cancelled.get(sid, at), at)
        elif new_value in NOTION_OFFER_STATUSES:
            status_at[sid] = max(status_at.get(sid, at), at)
    out = {}
    for sid in student_ids:
        at = got.get(sid)
        if at is not None and (sid not in cancelled or cancelled[sid] < at):
            out[sid] = at.astimezone(almaty).date()
        elif sid in status_at:
            out[sid] = status_at[sid].astimezone(almaty).date()
    return out


async def load_notion_items(
    db: AsyncSession, *, today: date, where: list | None = None, contract_id: uuid.UUID | None = None,
) -> list[ItemRow]:
    """Режим «только просмотр» (решение 15.11): одна строка на договор —
    «Остаток клиента» из Notion. Срок — после оффера (см. выше); без оффера
    строка в состоянии «ждёт оффера», а не в просрочке. id строки = id договора."""
    from app.core.config import settings

    stmt = (
        select(Contract, Student.full_name, User.name)
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False), Contract.client_remaining_amount.is_not(None),
               Contract.client_remaining_amount > 0)
        .order_by(Student.full_name.asc())
    )
    if contract_id is not None:
        stmt = stmt.where(Contract.id == contract_id)
    rows = [(c, n, m) for c, n, m in (await db.execute(stmt)).all()
            if not (c.pipeline_status and c.pipeline_status.value in NOTION_NOT_DEBT | IMPORT_SKIP_STATUSES)]
    offers = await offer_days(db, {c.student_id for c, _, _ in rows})
    out = []
    for contract, student_name, mzk_name in rows:
        status = contract.pipeline_status.value if contract.pipeline_status else None
        offer_day = offers.get(contract.student_id)
        if offer_day is None and status in NOTION_OFFER_STATUSES:
            offer_day = today  # оффер был, день неизвестен — к оплате сейчас
        due = offer_day + timedelta(days=settings.FINANCE_AFTER_OFFER_DAYS) if offer_day else None
        item = PaymentScheduleItem(
            id=contract.id, contract_id=contract.id, student_id=contract.student_id, kind=ScheduleKind.main,
            label="Остаток после оффера" if offer_day else "Остаток, ждёт оффера",
            amount=contract.client_remaining_amount, currency=contract.currency or "KZT",
            due_date=due, after_offer=due is None, note=None, created_at=contract.created_at,
        )
        if not all(_matches(item, cond) for cond in where or []):
            continue
        state = ItemState.after_offer if due is None else item_state(
            amount=item.amount, paid=Decimal("0"), due=due, today=today)
        out.append(ItemRow(item=item, paid=Decimal("0"), state=state, student_name=student_name, mzk_name=mzk_name,
                           pipeline_status=status, has_receipt=True))
    out.sort(key=lambda r: (r.item.due_date is None, r.item.due_date or date.max, r.student_name))
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
        "due_date": item.due_date.isoformat() if item.due_date else None,
        "after_offer": item.after_offer,
        "state": row.state.value,
        "days_overdue": (today - item.due_date).days if row.state is ItemState.overdue else 0,
        "note": item.note,
        "cancelled_at": item.cancelled_at.isoformat() if item.cancelled_at else None,
        "cancel_reason": item.cancel_reason,
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
        dated = [r for r in open_rows if r.item.due_date is not None]
        target = next((r for r in dated if event.old_value and r.item.due_date.isoformat() == event.old_value), None)
        if target is None and dated:
            target = dated[0]
        if target is not None:
            target.item.due_date = new_due
            moved = target.item
    event.status = FinanceChangeStatus.accepted
    event.schedule_item_id = moved.id if moved else None
    event.resolved_by = user.id
    event.resolved_at = datetime.now(timezone.utc)
    return moved


async def notify_notion_mismatches(db: AsyncSession, today: date) -> int:
    """Ежедневно: сколько договоров не сходится с Notion (в Notion остаток
    больше, чем по оплатам). Раз в день на финансиста, ссылка — «Проверка»."""
    contracts = (await db.execute(
        select(Contract).join(Student, Student.id == Contract.student_id)
        .where(Student.is_archived.is_(False), Contract.amount.is_not(None),
               Contract.client_remaining_amount.is_not(None), Contract.client_remaining_amount > 0)
    )).scalars().all()
    if not contracts:
        return 0
    paid = dict((await db.execute(
        select(Payment.contract_id, func.sum(Payment.amount))
        .where(Payment.contract_id.in_([c.id for c in contracts]), Payment.type == PaymentType.client_payment,
               Payment.status == PaymentStatus.paid).group_by(Payment.contract_id)
    )).all())
    count = sum(1 for c in contracts
                if notion_mismatch(c.amount, c.client_remaining_amount, paid.get(c.id) or Decimal("0")) is not None)
    if not count:
        return 0
    stamp = today.strftime("%d.%m.%Y")
    sent = 0
    for user in await finance_recipients(db):
        if await was_sent(db, user.id, kind="finance_notion_mismatch", body_contains=stamp):
            continue
        notify(db, user.id, kind="finance_notion_mismatch",
               title=f"Не сходится с Notion: {count} {_contracts_word(count)}",
               body=f"В Notion остаток больше, чем по оплатам. Сводка на {stamp}", link="/finance/review", priority="normal")
        sent += 1
    return sent


def _contracts_word(n: int) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return "договор"
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return "договора"
    return "договоров"


async def notify_due_today(db: AsyncSession, today: date) -> int:
    """Утреннее «сегодня ждём N оплат». Раз в день на финансиста: цикл
    напоминаний крутится каждые несколько часов, а дата в тексте — ключ
    повтора для was_sent."""
    rows = [r for r in await load_items(db, today=today, where=[PaymentScheduleItem.due_date == today])
            if r.state is ItemState.today]
    sent = await notify_notion_mismatches(db, today)
    if not rows:
        return sent
    left = sum((r.item.amount - r.paid for r in rows), Decimal("0"))
    stamp = today.strftime("%d.%m.%Y")
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


# --------------------------------------------------------------------------- распределение оплат

PAYER_LABELS = {"student": "Ученик", "parent": "Родитель", "other": "Другое"}


@dataclass
class AllocationPlan:
    """Куда ляжет оплата: строки графика по порядку и аванс (переплата)."""
    parts: list[tuple[ItemRow, Decimal]]
    advance: Decimal

    def to_dict(self) -> dict:
        return {
            "parts": [{
                "schedule_item_id": str(row.item.id),
                "label": row.item.label,
                "kind": row.item.kind.value,
                "due_date": row.item.due_date.isoformat() if row.item.due_date else None,
                "after_offer": row.item.after_offer,
                "amount": str(amount),
                "closes": amount >= row.item.amount - row.paid,
                "left_after": str(max(row.item.amount - row.paid - amount, Decimal("0"))),
            } for row, amount in self.parts],
            "advance": str(self.advance),
        }


async def _own_allocations(db: AsyncSession, payment_id: uuid.UUID | None) -> dict[uuid.UUID, Decimal]:
    if payment_id is None:
        return {}
    return dict((await db.execute(
        select(PaymentAllocation.schedule_item_id, PaymentAllocation.amount)
        .where(PaymentAllocation.payment_id == payment_id)
    )).all())


async def plan_allocation(
    db: AsyncSession, *, contract_id: uuid.UUID, amount: Decimal, today: date,
    prefer: uuid.UUID | None = None, payment_id: uuid.UUID | None = None,
) -> AllocationPlan:
    """Распределить оплату по неоплаченным строкам графика договора.

    Порядок: выбранная строка (если есть), затем строки со сроком — от
    ранней к поздней, в конце строки «после оффера». Что не легло ни на одну
    строку — аванс клиента, а не отрицательный остаток. При правке оплаты
    её собственное прежнее распределение не считается занятым (payment_id).
    """
    own = await _own_allocations(db, payment_id)
    rows = await load_items(db, today=today, contract_id=contract_id)
    for row in rows:
        row.paid -= own.get(row.item.id, Decimal("0"))
    open_rows = [r for r in rows if r.item.amount - r.paid > 0]
    open_rows.sort(key=lambda r: (r.item.id != prefer, r.item.due_date is None,
                                  r.item.due_date or date.max, r.item.created_at))
    rest = amount
    parts: list[tuple[ItemRow, Decimal]] = []
    for row in open_rows:
        if rest <= 0:
            break
        take = min(rest, row.item.amount - row.paid)
        parts.append((row, take))
        rest -= take
    return AllocationPlan(parts, max(rest, Decimal("0")))


async def apply_allocation(db: AsyncSession, payment: Payment, plan: AllocationPlan) -> None:
    """Записать распределение оплаты (прежнее заменяется целиком).
    payments.schedule_item_id — первая строка, для старых экранов."""
    from sqlalchemy import delete

    await db.execute(delete(PaymentAllocation).where(PaymentAllocation.payment_id == payment.id))
    for row, part in plan.parts:
        db.add(PaymentAllocation(payment_id=payment.id, schedule_item_id=row.item.id, amount=part))
    payment.schedule_item_id = plan.parts[0][0].item.id if plan.parts else None
    await db.flush()


async def find_duplicate(db: AsyncSession, *, contract_id: uuid.UUID, amount: Decimal, paid_at: date,
                         exclude: uuid.UUID | None = None) -> Payment | None:
    """Оплата с той же суммой и датой по договору — похоже, её уже внесли."""
    stmt = select(Payment).where(
        Payment.contract_id == contract_id, Payment.type == PaymentType.client_payment,
        Payment.status == PaymentStatus.paid, Payment.amount == amount, Payment.paid_at == paid_at,
    )
    if exclude is not None:
        stmt = stmt.where(Payment.id != exclude)
    return (await db.execute(stmt.limit(1))).scalar_one_or_none()


async def set_after_offer_due(db: AsyncSession, contract: Contract | None, offer_day: date) -> list[PaymentScheduleItem]:
    """Оффер получен: строкам «после оффера» без даты ставится срок
    дата оффера + FINANCE_AFTER_OFFER_DAYS."""
    from datetime import timedelta

    from app.core.config import settings

    if contract is None:
        return []
    items = (await db.execute(select(PaymentScheduleItem).where(
        PaymentScheduleItem.contract_id == contract.id, ACTIVE_ITEM,
        PaymentScheduleItem.after_offer.is_(True), PaymentScheduleItem.due_date.is_(None),
    ))).scalars().all()
    due = offer_day + timedelta(days=settings.FINANCE_AFTER_OFFER_DAYS)
    for item in items:
        item.due_date = due
    return list(items)


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
    open_rows = [r for r in rows if r.state is not ItemState.paid and r.item.due_date is not None]
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
            ~Contract.id.in_(select(PaymentScheduleItem.contract_id).where(ACTIVE_ITEM)),
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
