"""Раздел «Финансы»: сегодня, платежи, договоры, проверка.

Смотрит управление (finance_desk:view), ведут финансист и админ
(finance_desk:manage). Старый раздел /payments остаётся как был — здесь
другая единица учёта: ожидаемый платёж по графику, а не договор целиком.
"""
from __future__ import annotations

import re
import uuid
from zoneinfo import ZoneInfo
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.uploads import read_upload_capped
from app.models.contract import Contract, PipelineStatus
from app.models.trustme_contract import TrustMeContractLink
from app.models.service_act import ServiceAct
from typing import Literal
from app.models.document import DocSource, DocType, Document
from app.models.finance import FinanceChangeEvent, FinanceChangeStatus, PaymentAllocation, PaymentScheduleItem, ScheduleKind
from app.models.notification import Notification
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
from app.models.payment import Payment, PaymentMethod, PaymentStatus, PaymentType
from app.models.student import Student
from app.models.user import User, UserRole
from app.services import contract_finance, finance_desk
from app.services.finance_desk import ItemState
from app.services.minio_service import minio_delete, minio_upload
from app.services.notify import notify, was_sent

router = APIRouter(prefix="/finance", tags=["finance"])

Db = Annotated[AsyncSession, Depends(get_db)]


def _today() -> date:
    from app.services.task_urgency import company_today
    return company_today()


def _month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    nxt = (start + timedelta(days=32)).replace(day=1)
    return start, nxt


def _total(rows: list[dict], key: str = "left") -> str:
    return str(sum((Decimal(r[key]) for r in rows), Decimal("0")))


async def _items(db: AsyncSession, today: date, *where, contract_id: uuid.UUID | None = None,
                 include_cancelled: bool = False) -> list[dict]:
    rows = await finance_desk.load_items(db, today=today, where=list(where), contract_id=contract_id,
                                         include_cancelled=include_cancelled)
    return [finance_desk.item_to_dict(r, today) for r in rows]


# --------------------------------------------------------------------------- деньги по договорам


@dataclass
class ContractMoney:
    # Оплачено = сумма договора − остаток. Остаток синхронизирован с Notion и
    # уменьшается оплатами в платформе, так что сюда входят и деньги,
    # внесённые до запуска графиков. Без суммы договора — оплаты в платформе.
    paid: Decimal
    remaining: Decimal | None
    scheduled_open: Decimal
    has_schedule: bool
    next_item: dict | None
    recorded_paid: Decimal = Decimal("0")
    # Есть строка «после оффера» без даты: остаток ждёт оффера.
    waiting_offer: bool = False

    @property
    def undistributed(self) -> Decimal | None:
        """Сколько остатка не разложено по графику. Остаток считает
        contract_finance.client_remaining — то же правило, что везде в CRM."""
        if self.remaining is None:
            return None
        return self.remaining - self.scheduled_open


async def _client_paid(db: AsyncSession, contract_ids: list[uuid.UUID]) -> dict[uuid.UUID, Decimal]:
    if not contract_ids:
        return {}
    rows = (await db.execute(
        select(Payment.contract_id, Payment.type, func.sum(Payment.amount))
        .where(Payment.contract_id.in_(contract_ids),
               Payment.type.in_((PaymentType.client_payment, PaymentType.client_refund)),
               Payment.status == PaymentStatus.paid)
        .group_by(Payment.contract_id, Payment.type)
    )).all()
    # Возврат клиенту вычитается из «по оплатам» (задание 9).
    out: dict[uuid.UUID, Decimal] = {}
    for cid, kind, total in rows:
        sign = -1 if kind == PaymentType.client_refund else 1
        out[cid] = out.get(cid, Decimal("0")) + sign * (total or Decimal("0"))
    return out


async def _contract_money(db: AsyncSession, contracts: list[Contract], today: date) -> dict[uuid.UUID, ContractMoney]:
    ids = [c.id for c in contracts]
    paid = await _client_paid(db, ids)
    items: dict[uuid.UUID, list[dict]] = {}
    if ids:
        for item in await _items(db, today, PaymentScheduleItem.contract_id.in_(ids)):
            items.setdefault(uuid.UUID(item["contract_id"]), []).append(item)
    out = {}
    for c in contracts:
        p = paid.get(c.id, Decimal("0"))
        own = items.get(c.id, [])
        open_items = [i for i in own if i["state"] != ItemState.paid.value]
        remaining = contract_finance.client_remaining(c.amount, p, manual_remaining=c.client_remaining_amount)
        out[c.id] = ContractMoney(
            paid=max(c.amount - remaining, Decimal("0")) if c.amount is not None and remaining is not None else p,
            remaining=remaining,
            scheduled_open=sum((Decimal(i["left"]) for i in open_items), Decimal("0")),
            has_schedule=bool(own),
            next_item=open_items[0] if open_items else None,
            recorded_paid=p,
            waiting_offer=any(i["state"] == ItemState.after_offer.value for i in own),
        )
    return out


def _next_payment(money: ContractMoney, today: date) -> dict:
    """Что показать в колонке «Следующий платёж»."""
    if money.next_item is not None:
        state = money.next_item["state"]
        if state == ItemState.after_offer.value:
            return {"kind": "after_offer", "item": money.next_item}
        kind = "overdue" if state == "overdue" else "today" if state == "today" else "planned"
        return {"kind": kind, "item": money.next_item}
    if money.remaining is not None and money.remaining <= 0:
        return {"kind": "paid_full", "item": None}
    return {"kind": "not_planned", "item": None}


def _is_discrepancy(money: ContractMoney) -> bool:
    """Расхождение — только у договоров, где график уже начали вести: без
    графика договор и так помечен «Не запланирован», и на проде их сотни."""
    und = money.undistributed
    return money.has_schedule and und is not None and abs(und) >= 1


async def _discrepancies(db: AsyncSession, today: date) -> list[dict]:
    contracts = (await db.execute(
        select(Contract, Student)
        .join(Student, Student.id == Contract.student_id)
        .where(Student.is_archived.is_(False),
               Contract.id.in_(select(PaymentScheduleItem.contract_id).where(finance_desk.ACTIVE_ITEM)))
    )).all()
    money = await _contract_money(db, [c for c, _ in contracts], today)
    out = []
    for c, s in contracts:
        m = money[c.id]
        if _is_discrepancy(m):
            out.append({
                "contract_id": str(c.id), "student_name": s.full_name, "currency": c.currency,
                "remaining": str(m.remaining), "scheduled": str(m.scheduled_open), "undistributed": str(m.undistributed),
            })
    out.sort(key=lambda r: -abs(Decimal(r["undistributed"])))
    return out


async def _notion_mismatches(db: AsyncSession) -> list[dict]:
    """В Notion остаток больше, чем «сумма договора минус оплаты в платформе»:
    менеджер не обновил остаток после оплаты (решение 1 = А: остаток ведут
    в Notion, платформа только показывает расхождение)."""
    contracts = (await db.execute(
        select(Contract, Student, User.name)
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False), Contract.amount.is_not(None),
               Contract.client_remaining_amount.is_not(None), Contract.client_remaining_amount > 0)
    )).all()
    paid = await _client_paid(db, [c.id for c, _, _ in contracts])
    out = []
    for c, s, mzk_name in contracts:
        by_payments = finance_desk.notion_mismatch(c.amount, c.client_remaining_amount, paid.get(c.id, Decimal("0")))
        if by_payments is None:
            continue
        out.append({
            "contract_id": str(c.id), "student_id": str(s.id), "student_name": s.full_name, "mzk_name": mzk_name,
            "currency": c.currency, "amount": str(c.amount), "notion_remaining": str(c.client_remaining_amount),
            "by_payments": str(by_payments), "difference": str(c.client_remaining_amount - by_payments),
        })
    out.sort(key=lambda r: -Decimal(r["difference"]))
    return out


async def _review_count(db: AsyncSession) -> int:
    """Сколько ждёт решения в «Проверке» — одно число для меню, «Платежей» и
    самой «Проверки»: изменения сумм и дат, расхождения с Notion, договоры
    без графика, оплаты без чека."""
    from app.core.config import settings
    if settings.FINANCE_VIEW_ONLY:
        return await _new_changes_count(db)
    return (await _new_changes_count(db) + len(await _payments_without_receipt(db))
            + len(await _notion_mismatches(db)) + len(await _contracts_without_schedule(db))
            + len(await _contracts_without_act(db)))


async def _refunds_to_pay_count(db: AsyncSession) -> int:
    from app.models.refund_case import RefundCase
    return (await db.execute(select(func.count(RefundCase.id)).where(
        RefundCase.approved_at.is_not(None), RefundCase.payout_payment_id.is_(None),
        RefundCase.contract_id.is_not(None)))).scalar_one()


async def _offers_waiting_count(db: AsyncSession) -> int:
    """Офферы, по которым финансист ещё не нажал «Выставить» (событие
    «Оффер получен» не разобрано) — для счётчика «дел на сегодня»."""
    return (await db.execute(
        select(func.count(func.distinct(FinanceChangeEvent.contract_id))).where(
            FinanceChangeEvent.field == finance_desk.OFFER_FIELD,
            FinanceChangeEvent.status == FinanceChangeStatus.new,
            FinanceChangeEvent.contract_id.is_not(None),
        )
    )).scalar_one()


async def _payments_without_receipt(db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(Payment, Student.full_name, User.name, PaymentScheduleItem)
        .join(Contract, Contract.id == Payment.contract_id)
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Payment.recorded_by)
        .outerjoin(PaymentScheduleItem, PaymentScheduleItem.id == Payment.schedule_item_id)
        .where(Payment.type == PaymentType.client_payment, Payment.status == PaymentStatus.paid,
               ~Payment.id.in_(select(Document.payment_id).where(Document.payment_id.is_not(None))))
        .order_by(Payment.paid_at.desc())
    )).all()
    return [_payment_dict(p, name, recorder, item, False) for p, name, recorder, item in rows]


def _payment_dict(p: Payment, student_name: str, recorder: str | None, item: PaymentScheduleItem | None, has_receipt: bool,
                  allocations: list[dict] | None = None) -> dict:
    allocated = sum((Decimal(a["amount"]) for a in allocations or []), Decimal("0"))
    return {
        "status": p.status.value,
        "payer": p.payer,
        "cancelled_at": p.cancelled_at.isoformat() if p.cancelled_at else None,
        "cancel_reason": p.cancel_reason,
        # Распределение по строкам графика и аванс (что не легло ни на одну строку).
        "allocations": allocations or [],
        "advance": str(max(p.amount - allocated, Decimal("0"))) if allocations is not None else None,
        "id": str(p.id),
        "contract_id": str(p.contract_id),
        "student_name": student_name,
        "amount": str(p.amount),
        "currency": p.currency,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        "method": p.method.value if p.method else None,
        "schedule_item_id": str(p.schedule_item_id) if p.schedule_item_id else None,
        "kind": item.kind.value if item else None,
        "label": item.label if item else None,
        "note": p.note,
        "has_receipt": has_receipt,
        "recorded_by": recorder,
    }


# Офферы живут на «Платежах» (кнопка «Выставить»), в «Проверку» не попадают.
_REVIEW_EVENT = ~FinanceChangeEvent.field.in_(tuple(finance_desk.EVENT_FIELDS))


def _review_filter():
    # Режим «только просмотр» (15.11): офферы тоже в «Проверке» — одна кнопка «Просмотрено».
    from app.core.config import settings
    return ~FinanceChangeEvent.field.in_(tuple(finance_desk.REFUND_FIELDS)) if settings.FINANCE_VIEW_ONLY else _REVIEW_EVENT


async def _new_changes_count(db: AsyncSession) -> int:
    return (await db.execute(
        select(func.count(FinanceChangeEvent.id)).where(FinanceChangeEvent.status == FinanceChangeStatus.new, _review_filter())
    )).scalar_one()


# Работа по договору окончена — графика уже не ждём.
_CLOSED_STATUSES = (PipelineStatus.completed_admitted, PipelineStatus.changed_mind, PipelineStatus.lost_applicant,
                    PipelineStatus.refund, PipelineStatus.transferred_pipeline)


async def _contracts_without_schedule(db: AsyncSession, limit: int = 500) -> list[dict]:
    """Договор с остатком, но без графика: задача «Расписать график»."""
    rows = (await db.execute(
        select(Contract, Student, User.name).join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False), Contract.client_remaining_amount > 0,
               ~Contract.pipeline_status.in_(_CLOSED_STATUSES),
               ~Contract.id.in_(select(PaymentScheduleItem.contract_id).where(finance_desk.ACTIVE_ITEM)))
        .order_by(Contract.client_remaining_date.asc().nulls_last(), Student.full_name).limit(limit)
    )).all()
    return [{"contract_id": str(c.id), "student_name": s.full_name, "mzk_name": mzk, "currency": c.currency,
             "remaining": str(c.client_remaining_amount),
             "remaining_date": c.client_remaining_date.isoformat() if c.client_remaining_date else None}
            for c, s, mzk in rows]


# --------------------------------------------------------------------------- сегодня


@router.get("/today")
async def today_view(db: Db, current_user: CurrentUser):
    """«Сегодня» — список дел: оплаты на сегодня, просрочка, правки из Notion."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    month_start, month_end = _month_bounds(today)
    due_today = await _items(db, today, PaymentScheduleItem.due_date == today)
    overdue = [i for i in await _items(db, today, PaymentScheduleItem.due_date < today) if i["state"] == "overdue"]
    # Как в списке «Ожидаются»: с сегодняшнего дня, неоплаченные.
    future = [i for i in await _items(db, today, PaymentScheduleItem.due_date >= today) if i["state"] != "paid"]
    # Первыми — самые тяжёлые долги: сумма × дни просрочки (задание 6).
    overdue.sort(key=lambda i: -(Decimal(i["left"]) * i["days_overdue"]))
    # Долги (задание 8): последнее действие, нарушенное обещание, «обещали сегодня».
    from app.services import finance_debts
    debt_acts = await finance_debts.actions_by_item(db, [uuid.UUID(i["id"]) for i in overdue])
    debt_names = await _actor_names(db, [a for lst in debt_acts.values() for a in lst])
    promised_today = []
    for i in overdue:
        st = finance_debts.state_of(debt_acts.get(uuid.UUID(i["id"]), []), today)
        i["promise_broken"] = st.broken and st.promise is None
        i["last_action"] = _debt_action_dict(st.actions[-1], debt_names) if st.actions else None
        if st.promise is not None and st.promise.promise_date == today:
            promised_today.append({**i, "promise": _debt_action_dict(st.promise, debt_names)})
    received_by_currency = dict((await db.execute(
        select(Payment.currency, func.sum(Payment.amount)).join(Contract, Contract.id == Payment.contract_id)
        .join(Student, Student.id == Contract.student_id)
        .where(Student.is_archived.is_(False), Payment.type == PaymentType.client_payment,
               Payment.status == PaymentStatus.paid, Payment.paid_at >= month_start, Payment.paid_at < month_end)
        .group_by(Payment.currency))).all())
    planned_by_currency = dict((await db.execute(
        select(PaymentScheduleItem.currency, func.sum(PaymentScheduleItem.amount))
        .join(Student, Student.id == PaymentScheduleItem.student_id)
        .where(Student.is_archived.is_(False), finance_desk.ACTIVE_ITEM, PaymentScheduleItem.due_date >= month_start,
               PaymentScheduleItem.due_date < month_end).group_by(PaymentScheduleItem.currency))).all())
    received = received_by_currency.get('KZT', Decimal('0'))
    planned = planned_by_currency.get('KZT', Decimal('0'))
    changes = (await db.execute(
        select(FinanceChangeEvent, Student.full_name)
        .join(Student, Student.id == FinanceChangeEvent.student_id)
        .where(FinanceChangeEvent.status == FinanceChangeStatus.new)
        .order_by(FinanceChangeEvent.created_at.desc())
    )).all()
    return {
        "today": today.isoformat(),
        "due_today": due_today,
        "overdue": overdue[:5],
        "promised_today": promised_today,
        # Согласован, но не выплачен — дело на сегодня (задание 9).
        "refunds_to_pay": [r for r in (await refunds(db, current_user))["items"] if r["stage"] == "Согласован"],
        "overdue_count": len(overdue),
        "overdue_total": _total([i for i in overdue if i["currency"] == "KZT"]),
        "changes": [finance_desk.change_to_dict(e, name, None) for e, name in changes[:5]],
        "changes_count": len(changes),
        "month_received": str(received),
        "month_planned": str(planned),
        "month_totals": [{"currency": currency, "received": str(received_by_currency.get(currency, 0)),
                          "planned": str(planned_by_currency.get(currency, 0))}
                         for currency in sorted(set(received_by_currency) | set(planned_by_currency))],
        "notion_import_count": len(await finance_desk.notion_import_candidates(db)),
        "review_count": await _review_count(db),
        "due_today_total": _total([i for i in due_today if i["currency"] == "KZT" and i["state"] != "paid"]),
        # Пустой день: «На сегодня дел нет» и ближайший ожидаемый платёж.
        "next_expected": next(iter(future), None),
        "expected_count": len(future),
        # Плашка «Данные из Notion на HH:MM», если синк молчит больше 30 минут.
        "notion_synced_at": (lambda t: t.isoformat() if t else None)(await _notion_fresh(db)),
        "expected_total": _total([i for i in future if i["currency"] == "KZT"]),
        # Остаток есть, оффера ещё нет (режим «только просмотр»): не долг, ждём оффер.
        **(await _waiting_offer(db, today)),
    }


async def _waiting_offer(db: AsyncSession, today: date) -> dict:
    if not settings.FINANCE_VIEW_ONLY:
        return {}
    rows = [r for r in await finance_desk.load_notion_items(db, today=today) if r.state is ItemState.after_offer]
    return {"waiting_offer_count": len(rows),
            "waiting_offer_total": str(sum((r.item.amount for r in rows if r.item.currency == "KZT"), Decimal("0")))}


async def _notion_fresh(db: AsyncSession):
    from app.services import finance_summary, notion_sync
    if not notion_sync.is_configured():
        return None
    return await finance_summary.notion_fresh_at(db)


class PrefsIn(BaseModel):
    urgent: list[Literal["offer", "offer_cancelled", "client_fee", "status", "remaining", "refund"]]
    summary_hour: int = Field(ge=6, le=12)
    summary: bool = True
    # Замещение (задание 5): «Нет на месте с … по …» и заместитель.
    away_from: date | None = None
    away_to: date | None = None
    deputy_id: uuid.UUID | None = None


@router.get("/prefs")
async def get_prefs(db: Db, current_user: CurrentUser):
    """Настройки писем: какие события срочные, во сколько сводка, получать ли
    её (админ подписывается сам). Финансист и админ."""
    from app.services import finance_summary
    if current_user.role not in (UserRole.finance_manager, UserRole.admin):
        raise HTTPException(403, "Настройки писем есть у финансиста и админа")
    return {**finance_summary.prefs_of(current_user),
            "urgent_options": [{"key": k, "label": v} for k, v in finance_desk.URGENT_KEYS.items()],
            "address": finance_desk.finance_address(current_user),
            "away_from": (current_user.finance_prefs or {}).get("away_from"),
            "away_to": (current_user.finance_prefs or {}).get("away_to"),
            "deputy_id": (current_user.finance_prefs or {}).get("deputy_id"),
            "deputy_options": [{"id": str(u.id), "name": u.name, "role": u.role.value} for u in (await db.execute(
                select(User).where(User.is_active.is_(True), User.id != current_user.id,
                                   User.role.in_((UserRole.admin, UserRole.finance_manager))).order_by(User.name))).scalars()]}


@router.put("/prefs")
async def put_prefs(body: PrefsIn, db: Db, current_user: CurrentUser):
    if current_user.role not in (UserRole.finance_manager, UserRole.admin):
        raise HTTPException(403, "Настройки писем есть у финансиста и админа")
    user = await db.get(User, current_user.id)
    if (body.away_from is None) != (body.away_to is None) or (body.away_from and body.away_to < body.away_from):
        raise HTTPException(422, "Укажите обе даты отсутствия: с какого по какое число")
    if body.away_from and not body.deputy_id:
        raise HTTPException(422, "Выберите заместителя на время отсутствия")
    if body.deputy_id:
        deputy = await db.get(User, body.deputy_id)
        if deputy is None or not deputy.is_active or deputy.role not in (UserRole.admin, UserRole.finance_manager) or deputy.id == user.id:
            raise HTTPException(422, "Заместителем может быть админ или другой финансист")
    user.finance_prefs = {"urgent": sorted(set(body.urgent)), "summary_hour": body.summary_hour, "summary": body.summary,
                          "away_from": body.away_from.isoformat() if body.away_from else None,
                          "away_to": body.away_to.isoformat() if body.away_to else None,
                          "deputy_id": str(body.deputy_id) if body.deputy_id and body.away_from else None}
    await db.commit()
    from app.services import finance_summary
    return finance_summary.prefs_of(user)


@router.get("/counters")
async def counters(db: Db, current_user: CurrentUser):
    """Числа для меню. «Проверка» — непроверенные правки + оплаты без чека.
    Непрочитанные уведомления считает колокольчик."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    rows = await finance_desk.load_items(db, today=today, where=[PaymentScheduleItem.due_date <= today])
    new_changes = await _new_changes_count(db)
    no_receipt = len(await _payments_without_receipt(db))
    # «Проверка» — одно число везде (14.11): всё, что в её списке ждёт решения.
    offers_waiting = await _offers_waiting_count(db)
    due_today = sum(1 for r in rows if r.state is ItemState.today)
    return {
        # Дел на сегодня: оплаты со сроком сегодня и офферы, по которым остаток ещё не выставлен.
        "today_tasks": due_today + offers_waiting + (0 if settings.FINANCE_VIEW_ONLY else await _refunds_to_pay_count(db)),
        # Режим «только просмотр» (15.11): фронт скрывает кнопки ввода.
        "view_only": settings.FINANCE_VIEW_ONLY,
        "offers_waiting": offers_waiting,
        "due_today": due_today,
        "overdue": sum(1 for r in rows if r.state is ItemState.overdue),
        "new_changes": new_changes,
        "no_receipt": no_receipt,
        "review": await _review_count(db),
    }


# --------------------------------------------------------------------------- платежи


@router.get("/expected")
async def expected(db: Db, current_user: CurrentUser):
    """Вкладка «Ожидаются»: всё неоплаченное со сроком сегодня и позже."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    return [i for i in await _items(db, today, PaymentScheduleItem.due_date >= today) if i["state"] != "paid"]


_REMINDER_MARK = re.compile(r"\[schedule:([0-9a-f-]{36}):")


@router.get("/overdue")
async def overdue(db: Db, current_user: CurrentUser):
    """Вкладка «Просрочены», от самой старой просрочки. reminded_at —
    когда МЗК последний раз получил напоминание по этому платежу."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    items = [i for i in await _items(db, today, PaymentScheduleItem.due_date < today) if i["state"] == "overdue"]
    reminded: dict[str, datetime] = {}
    if items:
        for body, created in (await db.execute(
            select(Notification.body, Notification.created_at)
            .where(Notification.kind == "payment_overdue", Notification.body.contains("[schedule:"))
        )).all():
            m = _REMINDER_MARK.search(body or "")
            if m and (m.group(1) not in reminded or created > reminded[m.group(1)]):
                reminded[m.group(1)] = created
    for i in items:
        r = reminded.get(i["id"])
        i["reminded_at"] = r.isoformat() if r else None
    items.sort(key=lambda i: -i["days_overdue"])
    return items


@router.get("/received")
async def received(
    db: Db, current_user: CurrentUser,
    date_from: date = Query(...), date_to: date = Query(...),
):
    require_access(current_user, "finance_desk", Action.view)
    rows = (await db.execute(
        select(Payment, Student.full_name, User.name, PaymentScheduleItem)
        .join(Contract, Contract.id == Payment.contract_id)
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Payment.recorded_by)
        .outerjoin(PaymentScheduleItem, PaymentScheduleItem.id == Payment.schedule_item_id)
        .where(Payment.type == PaymentType.client_payment, Payment.status == PaymentStatus.paid,
               Payment.paid_at >= date_from, Payment.paid_at <= date_to, Student.is_archived.is_(False))
        .order_by(Payment.paid_at.desc())
    )).all()
    with_receipt = set((await db.execute(
        select(Document.payment_id).where(Document.payment_id.in_([p.id for p, *_ in rows]))
    )).scalars().all()) if rows else set()
    return [_payment_dict(p, name, recorder, item, p.id in with_receipt) for p, name, recorder, item in rows]


@router.get("/schedule")
async def schedule(
    db: Db, current_user: CurrentUser,
    date_from: date = Query(...), date_to: date = Query(...),
):
    """Календарь: все строки графика в периоде (не больше 100 дней)."""
    require_access(current_user, "finance_desk", Action.view)
    if (date_to - date_from).days > 100:
        raise HTTPException(status_code=400, detail="Период не больше 100 дней")
    return await _items(db, _today(), PaymentScheduleItem.due_date >= date_from, PaymentScheduleItem.due_date <= date_to)


class ScheduleItemIn(BaseModel):
    operation_key: uuid.UUID | None = None
    contract_id: uuid.UUID
    kind: ScheduleKind = ScheduleKind.main
    label: str | None = Field(default=None, max_length=200)
    amount: Decimal = Field(gt=0, decimal_places=2)
    # Пусто — только у строки «после оффера»: срок поставится при оффере.
    due_date: date | None = None
    after_offer: bool = False
    note: str | None = None


def _due_text(item: PaymentScheduleItem) -> str:
    return item.due_date.isoformat() if item.due_date else "после оффера"


class ScheduleItemPatch(BaseModel):
    kind: ScheduleKind | None = None
    label: str | None = Field(default=None, max_length=200)
    amount: Annotated[Decimal, Field(gt=0, decimal_places=2)] | None = None
    due_date: date | None = None
    note: str | None = None


async def _load_item(db: AsyncSession, item_id: uuid.UUID) -> PaymentScheduleItem:
    item = await db.get(PaymentScheduleItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    return item


async def _item_dict(db: AsyncSession, item: PaymentScheduleItem) -> dict:
    return (await _items(db, _today(), PaymentScheduleItem.id == item.id, include_cancelled=True))[0]


def _require_active(item: PaymentScheduleItem) -> None:
    if item.cancelled_at is not None:
        raise HTTPException(409, "Платёж отменён. Чтобы снова ждать оплату, добавьте новый платёж в график.")


@router.post("/schedule", status_code=201)
async def create_item(body: ScheduleItemIn, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.manage)
    contract = (await db.execute(select(Contract).where(Contract.id == body.contract_id).with_for_update())).scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    if body.due_date is None and not body.after_offer:
        raise HTTPException(422, "Укажите срок оплаты или отметьте «после оффера»")
    if body.operation_key:
        existing = (await db.execute(select(PaymentScheduleItem).where(PaymentScheduleItem.import_key == f'manual:{body.operation_key}'))).scalar_one_or_none()
        if existing:
            if existing.contract_id != contract.id or existing.amount != body.amount or existing.due_date != body.due_date or existing.kind != body.kind:
                raise HTTPException(409, 'Ключ операции уже использован для другого платежа графика')
            return await _item_dict(db, existing)
    item = PaymentScheduleItem(
        import_key=f'manual:{body.operation_key}' if body.operation_key else None,
        contract_id=contract.id, student_id=contract.student_id, kind=body.kind, label=body.label,
        amount=body.amount, currency=contract.currency or "KZT", due_date=body.due_date, note=body.note,
        after_offer=body.after_offer, created_by=current_user.id,
    )
    db.add(item)
    await db.flush()
    await log_change(db, "payment_schedule_item", item.id, "created", None,
                     f"{item.amount} · {_due_text(item)}", str(current_user.id))
    await db.commit()
    return await _item_dict(db, item)


@router.patch("/schedule/{item_id}")
async def update_item(item_id: uuid.UUID, body: ScheduleItemPatch, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    await db.execute(select(Contract.id).where(Contract.id == item.contract_id).with_for_update())
    await db.refresh(item)
    _require_active(item)
    paid = (await finance_desk.paid_by_item(db, [item.id])).get(item.id, Decimal('0'))
    if body.amount is not None and body.amount < paid:
        raise HTTPException(409, 'Сумма графика не может быть меньше уже внесённых оплат')
    for key, value in body.model_dump(exclude_unset=True).items():
        old = getattr(item, key)
        if value is None and key in ("amount", "due_date", "kind"):
            continue
        setattr(item, key, value)
        if key in ("amount", "due_date"):
            await log_change(db, "payment_schedule_item", item.id, key, str(old), str(value), str(current_user.id))
    await db.flush()
    await db.commit()
    return await _item_dict(db, item)


class PlanRowIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    due_date: date | None = None
    after_offer: bool = False
    label: str | None = Field(default=None, max_length=200)


class PlanIn(BaseModel):
    rows: list[PlanRowIn] = Field(min_length=1, max_length=36)
    kind: ScheduleKind = ScheduleKind.main
    operation_key: uuid.UUID | None = None


@router.post("/contracts/{contract_id}/schedule/plan", status_code=201)
async def plan_schedule(contract_id: uuid.UUID, body: PlanIn, db: Db, current_user: CurrentUser):
    """«Расписать график» шаблоном: все строки создаются одной операцией
    («Равными частями на N месяцев», «Предоплата + остаток после оффера»)."""
    require_access(current_user, "finance_desk", Action.manage)
    contract = (await db.execute(select(Contract).where(Contract.id == contract_id).with_for_update())).scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    if any(r.due_date is None and not r.after_offer for r in body.rows):
        raise HTTPException(422, "У каждого платежа нужен срок или отметка «после оффера»")
    if body.operation_key:
        key = f"plan:{body.operation_key}:0"
        if (await db.execute(select(PaymentScheduleItem.id).where(PaymentScheduleItem.import_key == key))).first():
            return {"created": 0, "repeated": True}
    created = []
    for n, r in enumerate(body.rows):
        item = PaymentScheduleItem(
            import_key=f"plan:{body.operation_key}:{n}" if body.operation_key else None,
            contract_id=contract.id, student_id=contract.student_id, kind=body.kind, label=r.label,
            amount=r.amount, currency=contract.currency or "KZT", due_date=None if r.after_offer else r.due_date,
            after_offer=r.after_offer, created_by=current_user.id,
        )
        db.add(item)
        created.append(item)
    await db.flush()
    for item in created:
        await log_change(db, "payment_schedule_item", item.id, "created", None, f"{item.amount} · {_due_text(item)}", str(current_user.id))
    await db.commit()
    return {"created": len(created), "repeated": False}


class CancelItemIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/schedule/{item_id}/cancel")
async def cancel_item(item_id: uuid.UUID, body: CancelItemIn, db: Db, current_user: CurrentUser):
    """Отменить платёж графика (решение 14.11.2026: ничего не удаляем).

    Строка остаётся в истории договора с причиной, кто и когда отменил, но
    не входит в суммы, «Ожидаются», «Просрочено» и календарь. По строке с
    оплатой отмена запрещена: сначала уменьшите сумму строки до оплаченной.
    """
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    await db.execute(select(Contract.id).where(Contract.id == item.contract_id).with_for_update())
    await db.refresh(item)
    _require_active(item)
    paid = (await finance_desk.paid_by_item(db, [item.id])).get(item.id, Decimal("0"))
    if paid > 0:
        raise HTTPException(status_code=409, detail="По платежу уже есть оплата, отменить нельзя. "
                                                    "Уменьшите сумму платежа до оплаченной.")
    reason = body.reason.strip()
    item.cancelled_at = datetime.now(timezone.utc)
    item.cancelled_by = current_user.id
    item.cancel_reason = reason
    await log_change(db, "payment_schedule_item", item.id, "cancelled",
                     f"{item.amount} · {_due_text(item)}", reason, str(current_user.id))
    await db.commit()
    return await _item_dict(db, item)


async def _allocations_by_payment(db: AsyncSession, payment_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[dict]]:
    if not payment_ids:
        return {}
    out: dict[uuid.UUID, list[dict]] = {}
    for alloc, item in (await db.execute(
        select(PaymentAllocation, PaymentScheduleItem)
        .join(PaymentScheduleItem, PaymentScheduleItem.id == PaymentAllocation.schedule_item_id)
        .where(PaymentAllocation.payment_id.in_(payment_ids))
        .order_by(PaymentScheduleItem.due_date.asc().nulls_last())
    )).all():
        out.setdefault(alloc.payment_id, []).append({
            "schedule_item_id": str(item.id), "kind": item.kind.value, "label": item.label,
            "due_date": item.due_date.isoformat() if item.due_date else None, "amount": str(alloc.amount),
        })
    return out


_JOURNAL_LABELS = {
    ("payment", "created"): "Внесена оплата",
    ("payment", "amount"): "Изменена сумма оплаты",
    ("payment", "paid_at"): "Изменена дата оплаты",
    ("payment", "method"): "Изменён способ оплаты",
    ("payment", "payer"): "Изменён плательщик",
    ("payment", "allocation"): "Изменено распределение оплаты",
    ("payment", "cancelled"): "Оплата отменена",
    ("payment", "schedule_item_id"): "Оплата привязана к графику",
    ("payment", "refund_paid"): "Выплачен возврат клиенту",
    ("payment_schedule_item", "created"): "Добавлен платёж в график",
    ("payment_schedule_item", "amount"): "Изменена сумма платежа",
    ("payment_schedule_item", "due_date"): "Перенесён срок платежа",
    ("payment_schedule_item", "cancelled"): "Платёж отменён",
    ("document", "created"): "Прикреплён чек",
    ("contract", "offer_issued"): "Остаток после оффера выставлен, срок",
    ("contract", "notion_remaining_reminder"): "Менеджеру напомнили обновить остаток в Notion",
    ("contract", "documents_checked"): "Документы проверены",
    ("contract", "act_reminder"): "МЗК напомнили про акт",
    ("contract", "number"): "Изменён номер договора",
}


async def _contract_debt_actions(db: AsyncSession, contract_id: uuid.UUID) -> list[dict]:
    """Вкладка «Долг» карточки: все действия по просроченным платежам договора."""
    from app.models.finance import DebtAction
    acts = (await db.execute(select(DebtAction).where(DebtAction.contract_id == contract_id)
                             .order_by(DebtAction.created_at.desc()))).scalars().all()
    names = await _actor_names(db, acts)
    return [_debt_action_dict(a, names) for a in acts]


async def _contract_journal(db: AsyncSession, contract: Contract, payments: list[Payment]) -> list[dict]:
    """Единая лента денег по договору: оплаты, график, чеки и изменения из
    Notion — кто, когда (Алматы), что было и что стало, причина."""
    from zoneinfo import ZoneInfo

    from app.models.status_history import StatusHistory

    item_ids = list((await db.execute(
        select(PaymentScheduleItem.id).where(PaymentScheduleItem.contract_id == contract.id))).scalars().all())
    # Все денежные операции договора, включая выплаты возвратов.
    payment_ids = list((await db.execute(select(Payment.id).where(Payment.contract_id == contract.id))).scalars().all())
    doc_ids = list((await db.execute(select(Document.id).where(Document.payment_id.in_(payment_ids)))).scalars().all()) if payment_ids else []
    ids = [contract.id] + item_ids + payment_ids + doc_ids
    rows = (await db.execute(
        select(StatusHistory).where(StatusHistory.entity_id.in_(ids)).order_by(StatusHistory.changed_at.desc()).limit(300)
    )).scalars().all() if ids else []
    users = {}
    actor_ids = set()
    for r in rows:
        try:
            actor_ids.add(uuid.UUID(r.changed_by))
        except (ValueError, TypeError):
            pass
    if actor_ids:
        users = {str(u.id): u.name for u in (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars()}
    tz = ZoneInfo("Asia/Almaty")
    out = []
    for r in rows:
        label = _JOURNAL_LABELS.get((r.entity_type, r.field_changed))
        if label is None:
            continue
        out.append({
            "at": r.changed_at.astimezone(tz).isoformat(), "what": label,
            "old": r.old_value, "new": r.new_value, "who": users.get(r.changed_by),
            "source": "platform",
        })
    for e in (await db.execute(
        select(FinanceChangeEvent).where(FinanceChangeEvent.contract_id == contract.id,
                                         FinanceChangeEvent.source == "notion")
        .order_by(FinanceChangeEvent.created_at.desc()).limit(100)
    )).scalars():
        out.append({
            "at": e.created_at.astimezone(tz).isoformat(), "what": finance_desk.describe_change(e),
            "old": None, "new": None, "who": "Notion", "source": "notion",
        })
    out.sort(key=lambda j: j["at"], reverse=True)
    return out


class AllocatePaymentIn(BaseModel):
    schedule_item_id: uuid.UUID


@router.post('/payments/{payment_id}/allocate')
async def allocate_payment(payment_id: uuid.UUID, body: AllocatePaymentIn, db: Db, current_user: CurrentUser):
    """Аванс (нераспределённую часть оплаты) положить на строку графика."""
    require_access(current_user, 'finance_desk', Action.manage)
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(404, 'Оплата не найдена')
    contract = (await db.execute(select(Contract).where(Contract.id == payment.contract_id).with_for_update())).scalar_one()
    await db.refresh(payment)
    if payment.type != PaymentType.client_payment or payment.status != PaymentStatus.paid:
        raise HTTPException(409, 'К графику привязывается только полученная оплата клиента')
    item = await _load_item(db, body.schedule_item_id)
    _require_active(item)
    if item.contract_id != contract.id or item.currency != payment.currency:
        raise HTTPException(422, 'Выберите платёж того же договора и в той же валюте')
    own = dict((await db.execute(select(PaymentAllocation.schedule_item_id, PaymentAllocation.amount)
                                 .where(PaymentAllocation.payment_id == payment.id))).all())
    free = payment.amount - sum(own.values(), Decimal('0'))
    if free <= 0:
        raise HTTPException(409, 'Оплата уже полностью распределена по графику')
    paid = (await finance_desk.paid_by_item(db, [item.id])).get(item.id, Decimal('0'))
    left = item.amount - paid
    if left <= 0:
        raise HTTPException(409, 'Этот платёж графика уже оплачен')
    take = min(free, left)
    existing = (await db.execute(select(PaymentAllocation).where(
        PaymentAllocation.payment_id == payment.id, PaymentAllocation.schedule_item_id == item.id))).scalar_one_or_none()
    if existing is not None:
        existing.amount += take
    else:
        db.add(PaymentAllocation(payment_id=payment.id, schedule_item_id=item.id, amount=take))
    payment.schedule_item_id = payment.schedule_item_id or item.id
    await log_change(db, 'payment', payment.id, 'schedule_item_id', None, f'{take} → график {item.id}', str(current_user.id))
    # Личная отметка финансиста: остаток договора и Notion не трогаем.
    await db.commit()
    return {'ok': True, 'allocated': str(take)}


PayerLiteral = Literal["student", "parent", "other"]


class PayIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    paid_at: date
    method: PaymentMethod
    payer: PayerLiteral | None = None
    note: str | None = Field(default=None, max_length=500)
    # «Похоже, эта оплата уже внесена. Всё равно добавить?» — да.
    confirm_duplicate: bool = False


class PaymentIn(PayIn):
    schedule_item_id: uuid.UUID | None = None


class PreviewIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    schedule_item_id: uuid.UUID | None = None
    payment_id: uuid.UUID | None = None


DUPLICATE_PAYMENT = "DUPLICATE_PAYMENT"


async def _guard_closed(db: AsyncSession, current_user, *days) -> None:
    """Закрытый месяц (задание 12): оплаты за него меняет только админ."""
    from app.api.v1.endpoints.finance_reports import is_closed
    if current_user.role == UserRole.admin:
        return
    for day in days:
        if await is_closed(db, day):
            raise HTTPException(409, f"Месяц {day:%m.%Y} закрыт: оплаты за него меняет только админ с причиной")


async def _record_payment(db: AsyncSession, contract: Contract, body: PayIn, current_user, prefer: uuid.UUID | None) -> tuple[Payment, finance_desk.AllocationPlan]:
    if body.paid_at > _today():
        raise HTTPException(status_code=400, detail="Дата оплаты не может быть в будущем")
    await _guard_closed(db, current_user, body.paid_at)
    if not body.confirm_duplicate and await finance_desk.find_duplicate(
            db, contract_id=contract.id, amount=body.amount, paid_at=body.paid_at):
        raise HTTPException(409, "Похоже, эта оплата уже внесена: по договору есть оплата с той же суммой и датой. Всё равно добавить?",
                            headers={"X-Error-Code": DUPLICATE_PAYMENT})
    plan = await finance_desk.plan_allocation(db, contract_id=contract.id, amount=body.amount, today=_today(), prefer=prefer)
    payment = Payment(
        contract_id=contract.id, type=PaymentType.client_payment, amount=body.amount,
        currency=contract.currency or "KZT", status=PaymentStatus.paid, paid_at=body.paid_at,
        recorded_by=current_user.id, note=body.note, method=body.method, payer=body.payer,
    )
    db.add(payment)
    await db.flush()
    await finance_desk.apply_allocation(db, payment, plan)
    await log_change(db, "payment", payment.id, "created", None,
                     f"{payment.amount} · {body.method.value}" + (f" · аванс {plan.advance}" if plan.advance else ""),
                     str(current_user.id))
    # Отметка — для самого финансиста: остаток договора не меняется, в Notion
    # и ученику ничего не уходит (решение 06.11 и 14.11.2026).
    return payment, plan


@router.post("/contracts/{contract_id}/payments/preview")
async def preview_payment(contract_id: uuid.UUID, body: PreviewIn, db: Db, current_user: CurrentUser):
    """Что закроет оплата до сохранения: строки графика и аванс."""
    require_access(current_user, "finance_desk", Action.view)
    contract = await db.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    plan = await finance_desk.plan_allocation(db, contract_id=contract.id, amount=body.amount, today=_today(),
                                              prefer=body.schedule_item_id, payment_id=body.payment_id)
    return plan.to_dict()


@router.post("/contracts/{contract_id}/payments", status_code=201)
async def add_payment(contract_id: uuid.UUID, body: PaymentIn, db: Db, current_user: CurrentUser):
    """Внести оплату по договору, со строкой графика или без: распределяется
    на ближайшие неоплаченные строки, переплата — аванс клиента."""
    require_access(current_user, "finance_desk", Action.manage)
    contract = (await db.execute(select(Contract).where(Contract.id == contract_id).with_for_update())).scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    if body.schedule_item_id is not None:
        item = await _load_item(db, body.schedule_item_id)
        _require_active(item)
        if item.contract_id != contract.id:
            raise HTTPException(422, "Платёж графика из другого договора")
    payment, plan = await _record_payment(db, contract, body, current_user, body.schedule_item_id)
    await db.commit()
    return {"payment_id": str(payment.id), **plan.to_dict()}


@router.post("/schedule/{item_id}/pay", status_code=201)
async def pay_item(item_id: uuid.UUID, body: PayIn, db: Db, current_user: CurrentUser):
    """Отметить оплату по строке графика. Сумма меньше ожидаемой — частичная
    оплата: строка остаётся открытой на разницу. Больше — излишек ложится на
    следующие строки, а что не легло — аванс клиента."""
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    contract = (await db.execute(select(Contract).where(Contract.id == item.contract_id).with_for_update())).scalar_one()
    # The contract lock serializes partial payments and balance changes.
    await db.refresh(item)
    _require_active(item)
    payment, plan = await _record_payment(db, contract, body, current_user, item.id)
    await db.commit()
    # payment_id нужен фронту, чтобы приложить чек к этому платежу.
    return {**await _item_dict(db, item), "payment_id": str(payment.id), "advance": str(plan.advance)}


class PaymentPatch(BaseModel):
    amount: Annotated[Decimal, Field(gt=0, decimal_places=2)] | None = None
    paid_at: date | None = None
    method: PaymentMethod | None = None
    payer: PayerLiteral | None = None
    note: str | None = Field(default=None, max_length=500)
    schedule_item_id: uuid.UUID | None = None
    reason: str = Field(min_length=3, max_length=500)
    confirm_duplicate: bool = False


async def _load_client_payment(db: AsyncSession, payment_id: uuid.UUID) -> tuple[Payment, Contract]:
    payment = await db.get(Payment, payment_id)
    if payment is None or payment.type != PaymentType.client_payment:
        raise HTTPException(404, "Оплата не найдена")
    contract = (await db.execute(select(Contract).where(Contract.id == payment.contract_id).with_for_update())).scalar_one()
    await db.refresh(payment)
    if payment.status != PaymentStatus.paid:
        raise HTTPException(409, "Оплата отменена, её нельзя изменить")
    return payment, contract


@router.patch("/payments/{payment_id}")
async def update_payment(payment_id: uuid.UUID, body: PaymentPatch, db: Db, current_user: CurrentUser):
    """Исправить оплату: сумма, дата, способ, плательщик, распределение.
    Причина обязательна, каждое поле — в журнал (было → стало)."""
    require_access(current_user, "finance_desk", Action.manage)
    payment, contract = await _load_client_payment(db, payment_id)
    data = body.model_dump(exclude_unset=True)
    reason = data.pop("reason").strip()
    confirm = data.pop("confirm_duplicate", False)
    prefer = data.pop("schedule_item_id", None)
    if data.get("paid_at") and data["paid_at"] > _today():
        raise HTTPException(status_code=400, detail="Дата оплаты не может быть в будущем")
    await _guard_closed(db, current_user, payment.paid_at, data.get("paid_at"))
    new_amount = data.get("amount") or payment.amount
    new_date = data.get("paid_at") or payment.paid_at
    if not confirm and (new_amount != payment.amount or new_date != payment.paid_at) and await finance_desk.find_duplicate(
            db, contract_id=contract.id, amount=new_amount, paid_at=new_date, exclude=payment.id):
        raise HTTPException(409, "Похоже, такая оплата уже внесена: по договору есть оплата с той же суммой и датой. Всё равно сохранить?",
                            headers={"X-Error-Code": DUPLICATE_PAYMENT})
    who = str(current_user.id)
    for key, value in data.items():
        old = getattr(payment, key)
        if value is None or value == old:
            continue
        setattr(payment, key, value)
        show = lambda v: v.value if hasattr(v, "value") else (v.isoformat() if hasattr(v, "isoformat") else str(v))
        if key != "note":
            await log_change(db, "payment", payment.id, key, show(old) if old is not None else None,
                             f"{show(value)} · причина: {reason}", who)
    if "amount" in data or prefer is not None:
        if prefer is not None:
            item = await _load_item(db, prefer)
            _require_active(item)
            if item.contract_id != contract.id:
                raise HTTPException(422, "Платёж графика из другого договора")
        before = await _allocations_by_payment(db, [payment.id])
        plan = await finance_desk.plan_allocation(db, contract_id=contract.id, amount=payment.amount, today=_today(),
                                                  prefer=prefer or payment.schedule_item_id, payment_id=payment.id)
        await finance_desk.apply_allocation(db, payment, plan)
        fmt = lambda parts: "; ".join(f"{p['label'] or p['kind']} {p['amount']}" for p in parts) or "не распределена"
        await log_change(db, "payment", payment.id, "allocation", fmt(before.get(payment.id, [])),
                         fmt(plan.to_dict()["parts"]) + (f"; аванс {plan.advance}" if plan.advance else ""), who)
    await db.commit()
    return {"ok": True}


class CancelPaymentIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("/payments/{payment_id}/cancel")
async def cancel_payment(payment_id: uuid.UUID, body: CancelPaymentIn, db: Db, current_user: CurrentUser):
    """Отменить оплату (ничего не удаляем): остаётся в истории зачёркнутой,
    в суммы не входит, строки графика снова ждут оплату."""
    require_access(current_user, "finance_desk", Action.manage)
    payment, _ = await _load_client_payment(db, payment_id)
    await _guard_closed(db, current_user, payment.paid_at)
    reason = body.reason.strip()
    payment.status = PaymentStatus.cancelled
    payment.cancelled_at = datetime.now(timezone.utc)
    payment.cancelled_by = current_user.id
    payment.cancel_reason = reason
    await log_change(db, "payment", payment.id, "cancelled", f"{payment.amount} · {payment.paid_at}", reason, str(current_user.id))
    await db.commit()
    return {"ok": True}


RECEIPT_MAX_SIZE = 20 * 1024 * 1024
_RECEIPT_MIME = ("application/pdf", "image/")


@router.post("/payments/{payment_id}/receipt", status_code=201)
async def upload_receipt(payment_id: uuid.UUID, db: Db, current_user: CurrentUser, file: UploadFile = File(...)):
    """Чек к платежу. Отдельно от /documents: та ручка открывает доступ ко
    всем документам ученика, а бухгалтеру нужен только чек. Ученику не виден."""
    require_access(current_user, "finance_desk", Action.manage)
    payment = await db.get(Payment, payment_id)
    if payment is None or payment.type is not PaymentType.client_payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    contract = await db.get(Contract, payment.contract_id)
    content = await read_upload_capped(file, RECEIPT_MAX_SIZE)
    try:
        import magic
        mime = magic.from_buffer(content, mime=True)
    except Exception:
        mime = file.content_type or "application/octet-stream"
    if not mime.startswith(_RECEIPT_MIME):
        raise HTTPException(status_code=422, detail="Чек — это PDF или фото")
    storage_path = await minio_upload(content=content, student_id=contract.student_id,
                                      filename=file.filename or "receipt", mime_type=mime)
    doc = Document(
        student_id=contract.student_id, uploaded_by=current_user.id, doc_type=DocType.other,
        file_name=file.filename or "receipt", file_size=len(content), mime_type=mime,
        storage_path=storage_path, source=DocSource.manual_upload, payment_id=payment.id,
    )
    db.add(doc)
    try:
        await db.flush()
        await log_change(db, "document", doc.id, "created", None, doc.file_name, str(current_user.id), source="finance_receipt")
        await db.commit()
    except Exception:
        await db.rollback()
        await minio_delete(storage_path)
        raise
    return {"id": str(doc.id), "file_name": doc.file_name}


@router.post("/schedule/{item_id}/remind")
async def remind_mzk(item_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """Напомнить МЗК ученика о просроченном платеже. Не чаще раза в день.
    Напоминание — в ленте долга, МЗК отвечает на «Долгах»."""
    from app.services import finance_debts
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    contract = await db.get(Contract, item.contract_id)
    if contract is None or contract.mzk_manager_id is None:
        raise HTTPException(status_code=409, detail="У договора не указан МЗК — напоминать некому")
    sent = await finance_debts.remind_mzk(db, item, current_user, _today())
    await db.commit()
    return {"ok": True, "already_sent": not sent}


# --------------------------------------------------------------------------- возвраты

_REFUND_STAGE = {
    "awaiting_execution": "Согласован", "executed": "Выплачен", "closed": "Выплачен", "rejected": "Отклонён",
}


@router.get("/refunds")
async def refunds(db: Db, current_user: CurrentUser):
    """«Возвраты»: запрошены → согласованы → выплачены (или отклонены). Справка
    по договору: оплачено, закрыто актами, выплачено менторам."""
    from app.models.refund_case import RefundCase
    from app.services.act_coverage import financial_coverage
    require_access(current_user, "finance_desk", Action.view)
    cases = (await db.execute(
        select(RefundCase, Student.full_name, Contract)
        .outerjoin(Contract, Contract.id == RefundCase.contract_id)
        .outerjoin(Student, Student.id == func.coalesce(RefundCase.student_id, Contract.student_id))
        .order_by(RefundCase.created_at.desc())
    )).all()
    contract_ids = [c.id for _, _, c in cases if c is not None]
    paid = await _client_paid(db, contract_ids)
    covered = await financial_coverage(db, contract_ids) if contract_ids else {}
    payouts = {p.id: p for p in (await db.execute(select(Payment).where(
        Payment.id.in_([rc.payout_payment_id for rc, _, _ in cases if rc.payout_payment_id])))).scalars()} if cases else {}
    items = []
    for rc, name, c in cases:
        stage = _REFUND_STAGE.get(rc.status.value, "Запрошен")
        if rc.payout_payment_id:
            stage = "Выплачен"
        cov = covered.get(c.id) if c else None
        pay = payouts.get(rc.payout_payment_id)
        items.append({
            "id": str(rc.id), "contract_id": str(c.id) if c else None, "student_name": name, "stage": stage,
            "status": rc.status.value, "reason": rc.reason, "requested": str(rc.amount) if rc.amount is not None else None,
            "approved": str(rc.approved_amount) if rc.approved_amount is not None else None,
            "decision": rc.decision, "opened_at": rc.opened_at.isoformat() if rc.opened_at else None,
            "approved_at": rc.approved_at.isoformat() if rc.approved_at else None,
            "paid_at": pay.paid_at.isoformat() if pay and pay.paid_at else None,
            "paid_amount": str(pay.amount) if pay else None,
            "contract_paid": str(paid.get(c.id, Decimal("0"))) if c else None,
            "services_closed": cov["services_closed"] if cov else None, "services_total": cov["services_total"] if cov else None,
            "mentor_paid": str(c.mentor_paid) if c and c.mentor_paid is not None else None,
        })
    return {"items": items}


class RefundPayoutIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    paid_at: date
    method: PaymentMethod
    note: str | None = Field(default=None, max_length=500)


@router.post("/refunds/{case_id}/payout", status_code=201)
async def refund_payout(case_id: uuid.UUID, body: RefundPayoutIn, db: Db, current_user: CurrentUser):
    """Финансист выплатил согласованный возврат: денежная операция «возврат
    клиенту», неоплаченные строки графика отменяются (не удаляются), кейс —
    «исполнен». Статус и остаток в Notion меняет менеджер (решение 1 = А)."""
    from app.models.refund_case import RefundCase, RefundCaseStatus
    require_access(current_user, "finance_desk", Action.manage)
    rc = (await db.execute(select(RefundCase).where(RefundCase.id == case_id).with_for_update())).scalar_one_or_none()
    if rc is None:
        raise HTTPException(404, "Возврат не найден")
    if rc.contract_id is None:
        raise HTTPException(409, "У возврата не указан договор")
    if rc.approved_at is None:
        raise HTTPException(409, "Возврат ещё не согласован руководителем")
    if rc.payout_payment_id:
        raise HTTPException(409, "Возврат уже выплачен")
    if body.paid_at > _today():
        raise HTTPException(400, "Дата выплаты не может быть в будущем")
    contract = (await db.execute(select(Contract).where(Contract.id == rc.contract_id).with_for_update())).scalar_one()
    payment = Payment(contract_id=contract.id, type=PaymentType.client_refund, amount=body.amount,
                      currency=contract.currency or "KZT", status=PaymentStatus.paid, paid_at=body.paid_at,
                      recorded_by=current_user.id, note=body.note, method=body.method)
    db.add(payment)
    await db.flush()
    rc.payout_payment_id = payment.id
    rc.status = RefundCaseStatus.executed
    rc.execution_confirmation = rc.execution_confirmation or f"Выплачено {body.amount} · {body.paid_at:%d.%m.%Y} · {body.method.value}"
    await log_change(db, "payment", payment.id, "refund_paid", None, f"{body.amount} · {body.method.value}", str(current_user.id))
    # Неоплаченные строки графика больше не ждём — отменяем с причиной.
    cancelled = 0
    for r in await finance_desk.load_items(db, today=_today(), contract_id=contract.id):
        if r.paid == 0:
            r.item.cancelled_at = datetime.now(timezone.utc)
            r.item.cancelled_by = current_user.id
            r.item.cancel_reason = "Возврат по договору"
            await log_change(db, "payment_schedule_item", r.item.id, "cancelled", f"{r.item.amount}", "Возврат по договору", str(current_user.id))
            cancelled += 1
    student = await db.get(Student, contract.student_id)
    await finance_desk.record_change(db, student=student, contract=contract, field=finance_desk.REFUND_PAID, old=None,
                                     new=str(body.amount), source="platform", actor=current_user, source_ref=f"refund_paid:{rc.id}")
    if contract.mzk_manager_id:
        notify(db, contract.mzk_manager_id, kind="finance_refund", title=f"{student.full_name}: возврат выплачен",
               body="Обновите статус и остаток в Notion.", link=f"/students/{student.id}", priority="high")
    await db.commit()
    return {"payment_id": str(payment.id), "cancelled_items": cancelled}


# --------------------------------------------------------------------------- долги


def _debt_action_dict(a, names: dict) -> dict:
    from app.services import finance_debts
    return {"id": str(a.id), "kind": a.kind, "label": finance_debts.KIND_LABELS.get(a.kind, a.kind),
            "text": finance_debts.action_text(a), "at": a.created_at.isoformat(), "who": names.get(a.actor_id),
            "promise_date": a.promise_date.isoformat() if a.promise_date else None,
            "promise_amount": str(a.promise_amount) if a.promise_amount is not None else None}


async def _actor_names(db: AsyncSession, actions) -> dict:
    ids = {a.actor_id for a in actions if a.actor_id}
    return {u.id: u.name for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars()} if ids else {}


@router.get("/debts")
async def debts(db: Db, current_user: CurrentUser):
    """«Долги»: все просроченные платежи — этап, последнее действие, обещание,
    ответственный; итоги по этапам. МЗК видит, где ждут его ответа."""
    from app.services import finance_debts
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    rows = [r for r in await finance_desk.load_items(db, today=today, where=[PaymentScheduleItem.due_date < today])
            if r.state is ItemState.overdue]
    acts = await finance_debts.actions_by_item(db, [r.item.id for r in rows])
    names = await _actor_names(db, [a for lst in acts.values() for a in lst])
    mzk_ids = dict((await db.execute(select(Contract.id, Contract.mzk_manager_id).where(
        Contract.id.in_({r.item.contract_id for r in rows})))).all()) if rows else {}
    items, totals = [], {}
    for r in rows:
        days = (today - r.item.due_date).days
        st = finance_debts.state_of(acts.get(r.item.id, []), today)
        left = r.item.amount - r.paid
        stage = finance_debts.stage(days)
        t = totals.setdefault(stage, {"stage": stage, "count": 0, "total": Decimal("0")})
        t["count"] += 1
        t["total"] += left
        last = st.actions[-1] if st.actions else None
        items.append({
            **finance_desk.item_to_dict(r, today), "stage": stage,
            "responsible": finance_debts.responsible(days, st.escalated),
            "last_action": _debt_action_dict(last, names) if last else None,
            "promise": _debt_action_dict(st.promise, names) if st.promise else None,
            "promise_broken": st.broken,
            "awaiting_mzk": bool(st.reminded_at and (st.replied_at is None or st.replied_at < st.reminded_at)),
            "mine": mzk_ids.get(r.item.contract_id) == current_user.id,
        })
    items.sort(key=lambda i: -(Decimal(i["left"]) * i["days_overdue"]))
    await finance_desk.attach_notion_urls(db, items)
    order = ["до 30 дней", "31–60 дней", "более 60 дней"]
    return {"items": items, "stages": [{**totals[k], "total": str(totals[k]["total"])} for k in order if k in totals]}


class DebtActionIn(BaseModel):
    kind: Literal["contact", "promise", "escalated", "reschedule"]
    channel: Literal["call", "message", "meeting"] | None = None
    with_whom: str | None = Field(default=None, max_length=200)
    result: str | None = Field(default=None, max_length=1000)
    promise_date: date | None = None
    promise_amount: Annotated[Decimal, Field(gt=0, decimal_places=2)] | None = None
    new_due: date | None = None


@router.post("/debts/{item_id}/actions", status_code=201)
async def add_debt_action(item_id: uuid.UUID, body: DebtActionIn, db: Db, current_user: CurrentUser):
    """Записать контакт, обещание, передать руководителю, перенести срок."""
    from app.services import finance_debts
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    _require_active(item)
    fields = {"channel": body.channel, "with_whom": body.with_whom, "result": (body.result or "").strip() or None}
    if body.kind == "contact" and not body.channel:
        raise HTTPException(422, "Укажите, как связались: звонок, сообщение или встреча")
    if body.kind == "promise":
        if not body.promise_date or body.promise_date < _today():
            raise HTTPException(422, "Укажите дату, когда обещали оплатить (сегодня или позже)")
        fields.update(promise_date=body.promise_date, promise_amount=body.promise_amount)
    if body.kind == "reschedule":
        if not body.new_due or not fields["result"]:
            raise HTTPException(422, "Укажите новый срок и с кем согласовано")
        old = item.due_date
        item.due_date = body.new_due
        await log_change(db, "payment_schedule_item", item.id, "due_date", str(old), f"{body.new_due} · {fields['result']}", str(current_user.id))
        fields["result"] = f"{old:%d.%m.%Y} → {body.new_due:%d.%m.%Y}. {fields['result']}"
    if body.kind == "escalated":
        for admin in (await db.execute(select(User).where(User.role == UserRole.admin, User.is_active.is_(True)))).scalars():
            student = await db.get(Student, item.student_id)
            notify(db, admin.id, kind="finance_debt", title=f"Долг передан руководителю: {student.full_name if student else ''}",
                   body=fields["result"] or "Финансист передал долг руководителю.", link=f"/finance/debts?item={item.id}", priority="high")
    action = await finance_debts.add_action(db, item, body.kind, current_user, **fields)
    await db.commit()
    return _debt_action_dict(action, {current_user.id: current_user.name})


class MzkReplyIn(BaseModel):
    answer: Literal["promised", "no_answer", "refund"]
    promise_date: date | None = None
    promise_amount: Annotated[Decimal, Field(gt=0, decimal_places=2)] | None = None
    note: str | None = Field(default=None, max_length=1000)


@router.post("/debts/{item_id}/mzk-reply", status_code=201)
async def mzk_reply(item_id: uuid.UUID, body: MzkReplyIn, db: Db, current_user: CurrentUser):
    """Ответ МЗК на напоминание: «Связался, обещали оплатить …», «Не дозвонился»,
    «Клиент хочет вернуть деньги». Отвечает МЗК договора (или финансист и админ)."""
    from app.services import finance_debts
    item = await _load_item(db, item_id)
    contract = await db.get(Contract, item.contract_id)
    is_own_mzk = current_user.role == UserRole.mzk_manager and contract and contract.mzk_manager_id == current_user.id
    if not is_own_mzk:
        require_access(current_user, "finance_desk", Action.manage)
    if body.answer == "promised" and (not body.promise_date or body.promise_date < _today()):
        raise HTTPException(422, "Укажите дату, когда клиент обещал оплатить")
    action = await finance_debts.add_action(
        db, item, "mzk_reply", current_user,
        result=" · ".join(x for x in (finance_debts.MZK_ANSWERS[body.answer], (body.note or "").strip()) if x),
        promise_date=body.promise_date if body.answer == "promised" else None,
        promise_amount=body.promise_amount if body.answer == "promised" else None,
    )
    student = await db.get(Student, item.student_id)
    for u in await finance_desk.finance_recipients(db):
        notify(db, u.id, kind="finance_debt", title=f"{student.full_name if student else 'Ученик'}: ответ МЗК по долгу",
               body=finance_debts.action_text(action), link=f"/finance/contracts/{item.contract_id}", priority="normal")
    await db.commit()
    return _debt_action_dict(action, {current_user.id: current_user.name})


# --------------------------------------------------------------------------- договоры


@router.get("/contracts")
async def contracts(
    db: Db, current_user: CurrentUser,
    q: str | None = None,
    status: str | None = Query(PipelineStatus.active_work.value, description="all — все статусы"),
    mzk: str | None = None,
    intake: int | None = None,
    schedule: str | None = Query(None, description="mismatch — график не равен остатку, none — графика нет"),
    documents: Literal["all", "no_contract", "no_act", "open"] = "all",
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=2000),  # таблица финансиста грузит все договоры и фильтрует у себя
):
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    stmt = (
        select(Contract, Student, User.name)
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False))
    )
    if q and q.strip():
        from sqlalchemy import or_ as _or
        stmt = stmt.where(_or(Student.full_name.ilike(f"%{q.strip()}%"), Contract.number.ilike(f"%{q.strip().lstrip('№').strip()}%")))
    if status and status != "all":
        stmt = stmt.where(Contract.pipeline_status == PipelineStatus(status))
    if mzk:
        stmt = stmt.where(User.name == mzk)
    if intake:
        stmt = stmt.where(Student.intake_year == intake)
    if documents in ("no_contract", "no_act"):
        from app.services.act_coverage import financial_coverage
        candidates = [c.id for c, _, _ in (await db.execute(stmt)).all()]
        covered = await financial_coverage(db, candidates)
        ids = [cid for cid in candidates if (not covered[cid]['contracts'] if documents == 'no_contract'
               else not covered[cid]['ready_act_count'])]
        stmt = stmt.where(Contract.id.in_(ids))
    if schedule == "none":
        stmt = stmt.where(~Contract.id.in_(select(PaymentScheduleItem.contract_id).where(finance_desk.ACTIVE_ITEM)))
    if schedule == "mismatch":
        # Расхождение считается в Python: остаток зависит от правила
        # contract_finance, повторять его в SQL — второе место для ошибки.
        candidates = (await db.execute(stmt.where(Contract.id.in_(select(PaymentScheduleItem.contract_id).where(finance_desk.ACTIVE_ITEM))))).all()
        money_all = await _contract_money(db, [c for c, _, _ in candidates], today)
        ids = [c.id for c, _, _ in candidates if _is_discrepancy(money_all[c.id])]
        stmt = stmt.where(Contract.id.in_(ids or [uuid.uuid4()]))
    if documents == "open":
        # Закрытие считается правилом act_coverage, как в таблице «Договоры и акты».
        from app.services.act_coverage import financial_coverage
        candidates = [c.id for c, _, _ in (await db.execute(stmt)).all()]
        covered = await financial_coverage(db, candidates)
        ids = [cid for cid in candidates if covered[cid]["services_total"] > covered[cid]["services_closed"]]
        stmt = stmt.where(Contract.id.in_(ids or [uuid.uuid4()]))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await db.execute(stmt.order_by(Student.full_name.asc()).offset((page - 1) * size).limit(size))).all()
    money = await _contract_money(db, [c for c, _, _ in rows], today)
    mzk_options = sorted(n for n in (await db.execute(
        select(User.name).join(Contract, Contract.mzk_manager_id == User.id).distinct())).scalars().all() if n)
    intake_options = sorted(i for i in (await db.execute(select(Student.intake_year).distinct())).scalars().all() if i)
    ids = [c.id for c, _, _ in rows]
    document_counts = dict((await db.execute(select(TrustMeContractLink.financial_contract_id, func.count()).where(
        TrustMeContractLink.financial_contract_id.in_(ids)).group_by(TrustMeContractLink.financial_contract_id))).all()) if ids else {}
    act_counts = dict((await db.execute(select(TrustMeContractLink.financial_contract_id, func.count(ServiceAct.id)).join(
        ServiceAct, ServiceAct.contract_link_id == TrustMeContractLink.id).where(
        TrustMeContractLink.financial_contract_id.in_(ids), ServiceAct.status == "ready").group_by(TrustMeContractLink.financial_contract_id))).all()) if ids else {}
    from app.services.act_coverage import financial_coverage
    covered = await financial_coverage(db, ids)
    originals = await _original_documents(db, [(c.id, s.id) for c, s, _ in rows], covered)
    await db.commit()  # состав услуг старых договоров, посчитанный один раз
    return {
        "items": await finance_desk.attach_notion_urls(db, [
            {**_contract_row(c, s, mzk_name, money[c.id], today), "trustme_count": document_counts.get(c.id, 0),
             "acts_count": act_counts.get(c.id, 0), **_coverage_brief(covered.get(c.id)),
             "originals": originals[c.id]} for c, s, mzk_name in rows]),
        "total": total, "page": page, "size": size,
        "mzk_options": mzk_options, "intake_options": intake_options,
    }


async def _original_documents(db: AsyncSession, pairs: list[tuple[uuid.UUID, uuid.UUID]], covered: dict) -> dict:
    """Настоящий договор ученика, который финансист открывает из «Договоров».

    По порядку: договор TrustMe, привязанный к этому договору; договор TrustMe
    ученика, ещё не привязанный ни к одному договору; загруженный скан
    договора (документ «Скан договора»). Первый найденный вид и показывается.
    Отозванные в TrustMe (status 4) не показываются — как в кабинете студента.
    """
    student_ids = {sid for _, sid in pairs}
    loose: dict[uuid.UUID, list[dict]] = {}
    scans: dict[uuid.UUID, list[dict]] = {}
    if student_ids:
        for link in (await db.execute(select(TrustMeContractLink).where(
                TrustMeContractLink.student_id.in_(student_ids),
                TrustMeContractLink.financial_contract_id.is_(None),
                TrustMeContractLink.status != 4).order_by(TrustMeContractLink.linked_at))).scalars():
            loose.setdefault(link.student_id, []).append(
                {"kind": "trustme", "id": str(link.id), "label": f"Договор №{link.number}" if link.number else "Договор TrustMe"})
        for doc in (await db.execute(select(Document).where(
                Document.student_id.in_(student_ids), Document.doc_type == DocType.contract_scan)
                .order_by(Document.uploaded_at))).scalars():
            scans.setdefault(doc.student_id, []).append(
                {"kind": "scan", "id": str(doc.id), "label": doc.display_name or doc.file_name})
    out = {}
    for contract_id, student_id in pairs:
        linked = [{"kind": "trustme", "id": c["id"], "label": f"Договор №{c['number']}" if c.get("number") else "Договор TrustMe"}
                  for c in (covered.get(contract_id) or {}).get("contracts", []) if c.get("status") != 4]
        out[contract_id] = linked or loose.get(student_id) or scans.get(student_id) or []
    return out


@router.get("/contracts/{contract_id}/scan/{doc_id}")
async def contract_scan(contract_id: uuid.UUID, doc_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """Скан договора для финансиста. Отдаётся только документ «Скан договора»
    того же ученика — карточки учеников и прочие документы финансисту закрыты."""
    from urllib.parse import quote

    from fastapi.responses import Response

    from app.services.minio_service import minio_download

    require_access(current_user, "finance_desk", Action.view)
    contract = await db.get(Contract, contract_id)
    doc = await db.get(Document, doc_id)
    if contract is None or doc is None or doc.student_id != contract.student_id or doc.doc_type not in (DocType.contract_scan, DocType.addendum_scan):
        raise HTTPException(404, "Скан договора не найден")
    content = await minio_download(doc.storage_path)
    inline = doc.mime_type in {"application/pdf", "image/jpeg", "image/png", "image/webp"}
    name = doc.display_name or doc.file_name or "Договор"
    return Response(content, media_type=doc.mime_type if inline else "application/octet-stream", headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="contract"; filename*=UTF-8\'\'{quote(name)}',
        "X-Content-Type-Options": "nosniff",
    })


def _act_cells(row) -> list[dict]:
    from app.services.act_coverage import SERVICE_COLUMNS, SERVICE_LABELS
    if not row:
        return []
    labels = {"missing": "Нужен", "ready": "Создан", "sent": "Отправлен"}
    return [{"service": SERVICE_LABELS.get(k, k), "state": cell["state"], "label": labels[cell["state"]],
             "date": cell.get("date")}
            for k in SERVICE_COLUMNS if (cell := row["cells"].get(k)) and cell["state"] != "none"]


def _coverage_brief(row) -> dict:
    """Договор TrustMe и закрытие услуг актами — для строки и карточки финансиста."""
    row = row or {"contracts": [], "services_total": 0, "services_closed": 0, "percent": None}
    return {"trustme": [{"id": c["id"], "number": c["number"], "status": c["status"], "source": c["source"]} for c in row["contracts"]],
            "services_total": row["services_total"], "services_closed": row["services_closed"], "closed_percent": row["percent"]}


def _services_block(c: Contract) -> list[dict]:
    """Блок «Услуги» карточки: суммы по услугам из Notion (колонки договора).
    Пока услуги не отдельные строки (решение 2 ждёт финансиста), это то, что
    менеджеры ведут в пайплайне: основная, английский, УП, профориентация, IELTS."""
    def row(name: str, total, paid=None) -> dict | None:
        if total is None and paid is None:
            return None
        rest = (total - paid) if total is not None and paid is not None else None
        return {"service": name, "amount": str(total) if total is not None else None,
                "paid": str(paid) if paid is not None else None,
                "remaining": str(max(rest, Decimal("0"))) if rest is not None else None}
    main_paid = (c.amount - c.client_remaining_amount) if c.amount is not None and c.client_remaining_amount is not None else None
    rows = [
        row("Основная", c.amount, main_paid),
        row("Английский", c.english_sum, c.english_paid),
        row("Улучшение портфолио", c.up_sum, c.up_paid),
        row("Профориентация", c.proforientation_sum),
        row("Экзамен IELTS", c.ielts_exam_fee),
    ]
    return [r for r in rows if r is not None]


def _contract_row(c: Contract, s: Student, mzk_name: str | None, money: ContractMoney, today: date) -> dict:
    return {
        "contract_id": str(c.id),
        "student_id": str(s.id),
        "student_name": s.full_name,
        "intake_year": s.intake_year,
        "pipeline_status": c.pipeline_status.value if c.pipeline_status else None,
        "degree": s.degree_level.value if s.degree_level else None,
        "schedule_mismatch": _is_discrepancy(money),
        "mzk_name": mzk_name,
        "currency": c.currency,
        "amount": str(c.amount) if c.amount is not None else None,
        "paid": str(money.paid),
        "recorded_paid": str(money.recorded_paid),
        "historical_paid": str(max(money.paid - money.recorded_paid, Decimal("0"))),
        "remaining": str(money.remaining) if money.remaining is not None else None,
        "next_payment": _next_payment(money, today),
        "waiting_offer": money.waiting_offer,
        # Номер из поля договора (ведут МЗК и админ); если пусто — фронт берёт номер TrustMe.
        "number": c.number,
        # Остаток «по оплатам», если в Notion он больше (решение 1 = А).
        "by_payments": (str(v) if (v := finance_desk.notion_mismatch(c.amount, money.remaining, money.recorded_paid)) is not None else None),
    }


@router.get("/acts-summary")
async def acts_summary(db: Db, current_user: CurrentUser):
    """Сводка для «Сегодня»: договоры TrustMe и закрытие услуг актами.
    Правило закрытия — act_coverage, как в таблице «Договоры и акты»."""
    require_access(current_user, "finance_desk", Action.view)
    from app.models.service_act import ActMailAttempt
    from app.services.act_coverage import SENT, financial_coverage
    today = _today()
    rows = (await db.execute(select(Contract, Student).join(Student, Student.id == Contract.student_id)
                             .where(Student.is_archived.is_(False)))).all()
    covered = await financial_coverage(db, [c.id for c, _ in rows])
    money = await _contract_money(db, [c for c, _ in rows], today)
    await db.commit()
    active = [(c, s) for c, s in rows if c.pipeline_status == PipelineStatus.active_work]
    percents = [covered[c.id]["percent"] for c, _ in active if covered[c.id]["percent"] is not None]
    month_start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
    made = (await db.execute(select(ServiceAct.id).where(ServiceAct.status == "ready", ServiceAct.created_at >= month_start))).scalars().all()
    sent = set((await db.execute(select(ActMailAttempt.act_id).where(ActMailAttempt.act_id.in_(made or [uuid.uuid4()]),
                                                                    ActMailAttempt.status.in_(SENT)))).scalars().all())
    paid_open = sorted(([c, s] for c, s in rows if money[c.id].remaining == 0 and c.amount
                        and covered[c.id]["services_total"] > covered[c.id]["services_closed"]),
                       key=lambda pair: covered[pair[0].id]["percent"] or 0)
    return {
        "active_total": len(active),
        "active_without_trustme": sum(not covered[c.id]["contracts"] for c, _ in active),
        "active_without_acts": sum(not covered[c.id]["ready_act_count"] for c, _ in active),
        "active_average_percent": round(sum(percents) / len(percents)) if percents else None,
        "month": {"created": len(made), "sent": len(sent), "not_sent": len(made) - len(sent)},
        "paid_not_closed": [{"contract_id": str(c.id), "student_name": s.full_name, "closed_percent": covered[c.id]["percent"],
                             "services_closed": covered[c.id]["services_closed"], "services_total": covered[c.id]["services_total"]}
                            for c, s in paid_open[:20]],
        "paid_not_closed_total": len(paid_open),
    }


# Договоры, по которым остаток уже не ждут: деньги возвращают или работа закрыта отказом.
_OFFER_SKIP = frozenset({PipelineStatus.refund, PipelineStatus.changed_mind, PipelineStatus.lost_applicant})


def _offer_after(offer_at: datetime | None, issued_at: datetime) -> bool:
    """Новый оффер пришёл уже после «Выставить» — выставлять снова."""
    return offer_at is not None and offer_at > issued_at


@router.post("/offers/{contract_id}/issue")
async def issue_offer_remaining(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """«Выставить»: клиенту сообщили остаток после оффера.

    Строкам графика «после оффера» без даты ставится срок (сегодня + N дней);
    если такой строки нет, а остаток не разложен по графику, создаётся строка
    «Остаток после оффера» на эту сумму. События «Оффер получен» по договору
    отмечаются разобранными («клиент уведомлён»).
    """
    from datetime import timedelta

    from app.core.config import settings

    require_access(current_user, "finance_desk", Action.manage)
    contract = (await db.execute(select(Contract).where(Contract.id == contract_id).with_for_update())).scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    today = _today()
    due = today + timedelta(days=settings.FINANCE_AFTER_OFFER_DAYS)
    dated = await finance_desk.set_after_offer_due(db, contract, today)
    created = None
    if not dated:
        money = (await _contract_money(db, [contract], today))[contract.id]
        rest = money.undistributed
        if rest is not None and rest > 0:
            created = PaymentScheduleItem(
                contract_id=contract.id, student_id=contract.student_id, kind=ScheduleKind.main,
                label="Остаток после оффера", amount=rest, currency=contract.currency or "KZT", due_date=due,
                after_offer=True, created_by=current_user.id,
            )
            db.add(created)
            await db.flush()
            await log_change(db, "payment_schedule_item", created.id, "created", None, f"{rest} · {due.isoformat()}", str(current_user.id))
    now = datetime.now(timezone.utc)
    events = (await db.execute(select(FinanceChangeEvent).where(
        FinanceChangeEvent.contract_id == contract.id, FinanceChangeEvent.field == finance_desk.OFFER_FIELD,
        FinanceChangeEvent.status == FinanceChangeStatus.new))).scalars().all()
    for e in events:
        e.status = FinanceChangeStatus.accepted
        e.resolved_by = current_user.id
        e.resolved_at = now
    await log_change(db, "contract", contract.id, "offer_issued", None, due.isoformat(), str(current_user.id))
    await db.commit()
    return {"due_date": due.isoformat(), "dated_items": len(dated), "created_item": str(created.id) if created else None}


@router.get("/search")
async def search_contracts(db: Db, current_user: CurrentUser, q: str = Query(..., min_length=2, max_length=100)):
    """Поиск в шапке раздела: часть ФИО, телефон (по цифрам) или номер
    договора TrustMe. До 8 договоров — для выпадающего списка."""
    import re

    from sqlalchemy import or_

    require_access(current_user, "finance_desk", Action.view)
    text = q.strip()
    digits = re.sub(r"\D", "", text)
    conds = [Student.full_name.ilike(f"%{text}%")]
    if len(digits) >= 4:
        conds.append(func.regexp_replace(func.coalesce(Student.phone, ""), r"\D", "", "g").like(f"%{digits}%"))
    numbered = select(TrustMeContractLink.financial_contract_id).where(
        TrustMeContractLink.number.ilike(f"%{text.lstrip('№').strip()}%"), TrustMeContractLink.financial_contract_id.is_not(None))
    numbered_students = select(TrustMeContractLink.student_id).where(
        TrustMeContractLink.number.ilike(f"%{text.lstrip('№').strip()}%"), TrustMeContractLink.financial_contract_id.is_(None))
    conds += [Contract.id.in_(numbered), Student.id.in_(numbered_students),
              Contract.number.ilike(f"%{text.lstrip('№').strip()}%")]
    rows = (await db.execute(
        select(Contract, Student, User.name).join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False), or_(*conds))
        .order_by(Student.full_name).limit(8)
    )).all()
    numbers: dict[uuid.UUID, list[str]] = {}
    if rows:
        for link in (await db.execute(select(TrustMeContractLink).where(
                TrustMeContractLink.student_id.in_({s.id for _, s, _ in rows}), TrustMeContractLink.status != 4,
                TrustMeContractLink.number.is_not(None)))).scalars():
            key = link.financial_contract_id or link.student_id
            numbers.setdefault(key, []).append(link.number)
    return [{
        "contract_id": str(c.id), "student_name": s.full_name, "phone": s.phone, "mzk_name": mzk,
        "number": c.number or ", ".join(numbers.get(c.id) or numbers.get(s.id) or []) or None,
        "remaining": str(c.client_remaining_amount) if c.client_remaining_amount is not None else None,
        "currency": c.currency,
        "pipeline_status": c.pipeline_status.value if c.pipeline_status else None,
    } for c, s, mzk in rows]


@router.post("/offers/{contract_id}/seen")
async def offer_seen(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """«Просмотрено» по офферу (режим «только просмотр»): события «Оффер
    получен» по договору отмечаются разобранными, график не трогаем."""
    require_access(current_user, "finance_desk", Action.manage)
    now = datetime.now(timezone.utc)
    events = (await db.execute(select(FinanceChangeEvent).where(
        FinanceChangeEvent.contract_id == contract_id,
        FinanceChangeEvent.field.in_((finance_desk.OFFER_FIELD, finance_desk.OFFER_CANCEL_FIELD)),
        FinanceChangeEvent.status == FinanceChangeStatus.new))).scalars().all()
    for e in events:
        e.status = FinanceChangeStatus.accepted
        e.resolved_by = current_user.id
        e.resolved_at = now
    await db.commit()
    return {"seen": len(events)}


@router.get("/offers-due")
async def offers_due(db: Db, current_user: CurrentUser):
    """«Оффер получен — закрыть остаток»: у ученика есть заявка с оффером или
    зачислением, а по договору ещё остаток. Оффер ставят в заявке ученика,
    остаток — из договора (Notion + оплаты в платформе). Ученик уходит из
    списка сам, когда остаток становится 0."""
    require_access(current_user, "finance_desk", Action.view)
    from app.models.application import Application
    from app.services.admission_guard import GUARDED_STATUSES

    today = _today()
    apps = (await db.execute(
        select(Application, Student).join(Student, Student.id == Application.student_id)
        .where(Application.submission_status.in_(GUARDED_STATUSES), Student.is_archived.is_(False))
    )).unique().all()
    if not apps:
        return {"items": [], "total": 0}
    # Когда финансист узнала об оффере: последнее «Оффер получен» по заявке
    # (после отмены и повторной отметки — новое). source_ref «offer:<id>[:…]».
    marked: dict[str, datetime] = {}
    # «Выставить» нажат: событие оффера разобрано — дата и кто.
    issued: dict[uuid.UUID, tuple[datetime, str | None]] = {}
    for ref, at, status, resolved_at, contract_id, resolver in (await db.execute(
        select(FinanceChangeEvent.source_ref, FinanceChangeEvent.created_at, FinanceChangeEvent.status,
               FinanceChangeEvent.resolved_at, FinanceChangeEvent.contract_id, User.name)
        .outerjoin(User, User.id == FinanceChangeEvent.resolved_by)
        .where(FinanceChangeEvent.field == finance_desk.OFFER_FIELD,
               FinanceChangeEvent.student_id.in_({s.id for _, s in apps}))
    )).all():
        key = ":".join((ref or "").split(":")[:2])
        if key not in marked or at > marked[key]:
            marked[key] = at
        if contract_id and status is not FinanceChangeStatus.new and resolved_at:
            if contract_id not in issued or resolved_at > issued[contract_id][0]:
                issued[contract_id] = (resolved_at, resolver)
    contracts = (await db.execute(
        select(Contract).where(Contract.student_id.in_({s.id for _, s in apps}))
        .order_by(Contract.created_at.desc())
    )).scalars().all()
    by_id = {c.id: c for c in contracts}
    latest: dict[uuid.UUID, Contract] = {}
    for c in contracts:
        latest.setdefault(c.student_id, c)
    # Один ученик — одна строка: по договору, с самым свежим оффером.
    rows: dict[uuid.UUID, dict] = {}
    for app, student in apps:
        contract = by_id.get(app.contract_id) or latest.get(student.id)
        if contract is None or contract.pipeline_status in _OFFER_SKIP:
            continue
        at = marked.get(f"offer:{app.id}")
        where = ", ".join(x for x in (app.university, app.country) if x) or "вуз не указан"
        row = rows.get(contract.id)
        if row is None or (at and (row["_at"] is None or at > row["_at"])):
            rows[contract.id] = {"_at": at, "contract": contract, "student": student, "university": where,
                                 "enrolled": app.submission_status.value == "enrolled",
                                 "offers": (row["offers"] if row else 0)}
        rows[contract.id]["offers"] += 1
    money = await _contract_money(db, [r["contract"] for r in rows.values()], today)
    await db.commit()
    items = []
    for r in rows.values():
        c, m = r["contract"], money[r["contract"].id]
        if m.remaining is None or m.remaining <= 0:
            continue
        by_payments = finance_desk.notion_mismatch(c.amount, c.client_remaining_amount, m.recorded_paid)
        items.append({
            "contract_id": str(c.id),
            "student_id": str(r["student"].id),
            "student_name": r["student"].full_name,
            "university": r["university"],
            "offers": r["offers"],
            "enrolled": r["enrolled"],
            # По Алматы: фронт берёт дату из первых 10 символов, UTC сдвигал ночные офферы на вчера.
            "offer_at": r["_at"].astimezone(ZoneInfo("Asia/Almaty")).isoformat() if r["_at"] else None,
            "amount": str(c.amount) if c.amount is not None else None,
            "paid": str(m.paid) if m.paid is not None else None,
            "remaining": str(m.remaining),
            "remaining_date": c.client_remaining_date.isoformat() if c.client_remaining_date else None,
            "currency": c.currency,
            # Остаток «по оплатам», если в Notion он больше: «В Notion X, по оплатам Y».
            "by_payments": str(by_payments) if by_payments is not None else None,
            "issued_at": issued[c.id][0].isoformat() if c.id in issued and not _offer_after(r["_at"], issued[c.id][0]) else None,
            "issued_by": issued[c.id][1] if c.id in issued and not _offer_after(r["_at"], issued[c.id][0]) else None,
        })
    # Свежие офферы сверху; без даты (отмечены до появления уведомлений) — в конце.
    items.sort(key=lambda i: (i["offer_at"] is None, -(datetime.fromisoformat(i["offer_at"]).timestamp() if i["offer_at"] else 0)))
    await finance_desk.attach_notion_urls(db, items)
    return {"items": items, "total": len(items)}


@router.get("/contracts/{contract_id}")
async def contract_detail(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    row = (await db.execute(
        select(Contract, Student, User.name)
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Contract.id == contract_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    c, student, mzk_name = row
    money = (await _contract_money(db, [c], today))[c.id]
    payments = (await db.execute(
        select(Payment, User.name, PaymentScheduleItem)
        .outerjoin(User, User.id == Payment.recorded_by)
        .outerjoin(PaymentScheduleItem, PaymentScheduleItem.id == Payment.schedule_item_id)
        .where(Payment.contract_id == c.id, Payment.type == PaymentType.client_payment,
               Payment.status.in_((PaymentStatus.paid, PaymentStatus.cancelled)))
        .order_by(Payment.paid_at.desc().nulls_last())
    )).all()
    alloc_by_payment = await _allocations_by_payment(db, [p.id for p, *_ in payments])
    with_receipt = set((await db.execute(
        select(Document.payment_id).where(Document.payment_id.in_([p.id for p, *_ in payments]))
    )).scalars().all()) if payments else set()
    actor = User.__table__.alias("actor")
    events = (await db.execute(
        select(FinanceChangeEvent, User.name, actor.c.name)
        .outerjoin(User, User.id == FinanceChangeEvent.resolved_by)
        .outerjoin(actor, actor.c.id == FinanceChangeEvent.actor_id)
        .where(FinanceChangeEvent.contract_id == c.id)
        .order_by(FinanceChangeEvent.created_at.desc()).limit(50)
    )).all()
    snapshot = (await db.execute(
        select(NotionSnapshot).where(NotionSnapshot.student_id == student.id,
                                     NotionSnapshot.status == NotionMatchStatus.linked).limit(1)
    )).scalar_one_or_none()
    from app.services.act_coverage import financial_coverage
    coverage = await financial_coverage(db, [c.id])
    covered = coverage.get(c.id)
    originals = await _original_documents(db, [(c.id, student.id)], coverage)
    await db.commit()
    return {
        **_contract_row(c, student, mzk_name, money, today), **_coverage_brief(covered),
        "originals": originals[c.id],
        "phone": student.phone,
        "services": _services_block(c),
        "addenda": [{"id": str(d.id), "label": d.display_name or d.file_name} for d in (await db.execute(
            select(Document).where(Document.student_id == student.id, Document.doc_type == DocType.addendum_scan)
            .order_by(Document.uploaded_at))).scalars()],
        "documents_checked_at": c.documents_checked_at.isoformat() if c.documents_checked_at else None,
        "documents_checked_by": (await db.get(User, c.documents_checked_by)).name if c.documents_checked_by else None,
        # Акты по услугам договора: «нужен» (акта нет), «создан», «отправлен» — ведёт МЗК в «Актах».
        "act_cells": _act_cells(covered),
        "signed_date": c.signed_date.isoformat() if c.signed_date else None,
        "source": "Notion" if snapshot else "Платформа",
        "synced_at": snapshot.synced_at.isoformat() if snapshot and snapshot.synced_at else None,
        "scheduled": str(money.scheduled_open),
        "undistributed": str(money.undistributed) if money.undistributed is not None else None,
        # Отменённые строки — в истории карточки, зачёркнутыми.
        "schedule": await _items(db, today, contract_id=c.id, include_cancelled=True),
        "payments": [_payment_dict(p, student.full_name, recorder, item, p.id in with_receipt,
                                   alloc_by_payment.get(p.id, []))
                     for p, recorder, item in payments],
        "journal": await _contract_journal(db, c, [p for p, *_ in payments]),
        "debt_actions": await _contract_debt_actions(db, c.id),
        "changes": [finance_desk.change_to_dict(e, student.full_name, resolver, mzk_name, who)
                    for e, resolver, who in events],
    }


# --------------------------------------------------------------------------- проверка


@router.get("/review")
async def review(db: Db, current_user: CurrentUser, limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0), status: Literal["new", "all"] = "all"):
    """Всё, что ждёт решения бухгалтера: правки из Notion, оплаты без чека,
    расхождения графика с остатком."""
    require_access(current_user, "finance_desk", Action.view)
    mzk_user = User.__table__.alias("mzk_user")
    actor = User.__table__.alias("actor")
    stmt = (select(FinanceChangeEvent, Student.full_name, User.name, mzk_user.c.name, actor.c.name)
        .join(Student, Student.id == FinanceChangeEvent.student_id)
        .outerjoin(User, User.id == FinanceChangeEvent.resolved_by)
        .outerjoin(actor, actor.c.id == FinanceChangeEvent.actor_id)
        .outerjoin(Contract, Contract.id == FinanceChangeEvent.contract_id)
        .outerjoin(mzk_user, mzk_user.c.id == Contract.mzk_manager_id)
        .where(_review_filter())
        .order_by((FinanceChangeEvent.status == FinanceChangeStatus.new).desc(), FinanceChangeEvent.created_at.desc(), FinanceChangeEvent.id))
    if status == 'new':
        stmt = stmt.where(FinanceChangeEvent.status == FinanceChangeStatus.new)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    pending_total = await _new_changes_count(db)
    events = (await db.execute(stmt.offset(offset).limit(limit))).all()
    changes = await finance_desk.attach_notion_urls(
        db, [finance_desk.change_to_dict(e, name, resolver, mzk, who) for e, name, resolver, mzk, who in events])
    return {
        "total": total, "pending_total": pending_total, "offset": offset, "limit": limit,
        "changes": changes,
        "view_only": settings.FINANCE_VIEW_ONLY,
        **({} if not settings.FINANCE_VIEW_ONLY else {"no_receipt": [], "discrepancies": [], "notion_mismatches": [], "no_schedule": [], "no_act": []}),
    } if settings.FINANCE_VIEW_ONLY else {
        "total": total, "pending_total": pending_total, "offset": offset, "limit": limit,
        "changes": changes,
        "view_only": False,
        "no_receipt": await _payments_without_receipt(db),
        "discrepancies": await _discrepancies(db, _today()),
        "notion_mismatches": await _notion_mismatches(db),
        "no_schedule": await _contracts_without_schedule(db),
        "no_act": await _contracts_without_act(db),
    }


@router.post("/contracts/{contract_id}/documents-checked")
async def documents_checked(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """Финансист отметил «Документы проверены»: договор, допсоглашения, акты."""
    require_access(current_user, "finance_desk", Action.manage)
    contract = await db.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    contract.documents_checked_at = datetime.now(timezone.utc)
    contract.documents_checked_by = current_user.id
    await log_change(db, "contract", contract.id, "documents_checked", None, "проверено", str(current_user.id))
    await db.commit()
    return {"documents_checked_at": contract.documents_checked_at.isoformat(), "documents_checked_by": current_user.name}


@router.post("/contracts/{contract_id}/remind-act")
async def remind_act(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """«Напомнить МЗК»: по оплаченному договору нет акта — МЗК получает
    колокольчик со ссылкой на карточку ученика. Не чаще раза в день."""
    require_access(current_user, "finance_desk", Action.manage)
    row = (await db.execute(select(Contract, Student).join(Student, Student.id == Contract.student_id)
                            .where(Contract.id == contract_id))).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    c, s = row
    if c.mzk_manager_id is None:
        raise HTTPException(409, "У договора не указан МЗК")
    mark = f"[act:{c.id}:{_today().isoformat()}]"
    if await was_sent(db, c.mzk_manager_id, kind="finance_act_missing", body_contains=mark):
        return {"ok": True, "already": True}
    notify(db, c.mzk_manager_id, kind="finance_act_missing", title=f"{s.full_name}: нужен акт",
           body=f"Договор оплачен, а акта по услугам нет. Создайте акт в карточке ученика. {mark}",
           link=f"/students/{s.id}", priority="high")
    await log_change(db, "contract", c.id, "act_reminder", None, None, str(current_user.id))
    await db.commit()
    return {"ok": True, "already": False}


async def _contracts_without_act(db: AsyncSession) -> list[dict]:
    """Оплачен полностью (остаток 0), услуги в договоре TrustMe есть, а актов
    на них нет — событие «Нет акта» в «Проверке» (задание 11)."""
    from app.services.act_coverage import financial_coverage

    rows = (await db.execute(
        select(Contract, Student, User.name).join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id)
        .where(Student.is_archived.is_(False), Contract.amount.is_not(None), Contract.client_remaining_amount == 0)
    )).all()
    if not rows:
        return []
    covered = await financial_coverage(db, [c.id for c, _, _ in rows])
    out = []
    for c, s, mzk in rows:
        row = covered.get(c.id)
        if not row or row["services_total"] <= row["services_closed"]:
            continue
        out.append({"contract_id": str(c.id), "student_name": s.full_name, "mzk_name": mzk,
                    "missing": row["services_total"] - row["services_closed"], "total": row["services_total"]})
    return out


@router.post("/contracts/{contract_id}/remind-notion")
async def remind_notion(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """«Сообщить менеджеру»: МЗК договора получает колокольчик — обновить
    остаток в Notion. Не чаще раза в день по договору."""
    require_access(current_user, "finance_desk", Action.manage)
    row = (await db.execute(select(Contract, Student).join(Student, Student.id == Contract.student_id)
                            .where(Contract.id == contract_id))).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
    c, s = row
    if c.mzk_manager_id is None:
        raise HTTPException(409, "У договора не указан МЗК")
    by_payments = finance_desk.notion_mismatch(c.amount, c.client_remaining_amount, await finance_desk.recorded_paid(db, c.id))
    if by_payments is None:
        raise HTTPException(409, "Остаток в Notion уже сходится с оплатами")
    mark = f"[notion-remaining:{c.id}:{_today().isoformat()}]"
    if await was_sent(db, c.mzk_manager_id, kind="finance_notion_remaining", body_contains=mark):
        return {"ok": True, "already": True}
    fmt = lambda v: f"{v:,.0f} ₸".replace(",", "\u00a0")
    notify(db, c.mzk_manager_id, kind="finance_notion_remaining",
           title=f"{s.full_name}: обновите остаток в Notion",
           body=f"В Notion остаток {fmt(c.client_remaining_amount)}, по оплатам {fmt(by_payments)}. {mark}",
           link=f"/students/{s.id}", priority="high")
    await log_change(db, "contract", c.id, "notion_remaining_reminder", None, str(by_payments), str(current_user.id))
    await db.commit()
    return {"ok": True, "already": False}


async def _open_event(db: AsyncSession, event_id: uuid.UUID) -> FinanceChangeEvent:
    event = (await db.execute(select(FinanceChangeEvent).where(FinanceChangeEvent.id == event_id).with_for_update())).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Изменение не найдено")
    if event.status is not FinanceChangeStatus.new:
        raise HTTPException(status_code=409, detail="Изменение уже проверено")
    return event


class AcceptIn(BaseModel):
    # Только для даты оплаты: перенести ли ожидаемый платёж в графике.
    move_schedule: bool = False


@router.post("/changes/{event_id}/accept")
async def accept_change(event_id: uuid.UUID, db: Db, current_user: CurrentUser, body: AcceptIn | None = None):
    require_access(current_user, "finance_desk", Action.manage)
    event = await _open_event(db, event_id)
    before: dict = {}
    if event.contract_id:
        before = {r.item.id: r.item.due_date for r in await finance_desk.load_items(db, today=_today(), contract_id=event.contract_id)}
    moved = await finance_desk.apply_accepted_change(
        db, event, user=current_user, today=_today(), move_schedule=bool(body and body.move_schedule))
    if moved is not None:
        old_due = before.get(moved.id)
        await log_change(db, "payment_schedule_item", moved.id, "due_date",
                         old_due.isoformat() if old_due else None, moved.due_date.isoformat(),
                         str(current_user.id), "notion_change")
        await db.flush()
    await db.commit()
    return {"ok": True, "moved_item_id": str(moved.id) if moved else None}


@router.post("/changes/{event_id}/reject")
async def reject_change(event_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """«Отклонить» — правка в Notion не принимается в работу, график не трогаем."""
    require_access(current_user, "finance_desk", Action.manage)
    event = await _open_event(db, event_id)
    event.status = FinanceChangeStatus.kept
    event.resolved_by = current_user.id
    event.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- перенос из Notion


@router.get("/notion-import")
async def notion_import_preview(db: Db, current_user: CurrentUser):
    """Сколько договоров получат первый платёж графика из «Остаток клиента (дата)»."""
    require_access(current_user, "finance_desk", Action.view)
    rows = await finance_desk.notion_import_candidates(db)
    return {"count": len(rows), "total": str(sum((r for _, _, r in rows), Decimal("0")))}


@router.post("/notion-import")
async def notion_import(db: Db, current_user: CurrentUser):
    """Разово: по договору без графика создать платёж «Остаток из Notion»
    на сумму остатка со сроком из Notion. Повторный вызов договоры с графиком
    пропускает, поэтому безопасен."""
    require_access(current_user, "finance_desk", Action.manage)
    created = 0
    candidates = await finance_desk.notion_import_candidates(db)
    for candidate, student, remaining in sorted(candidates, key=lambda row: str(row[0].id)):
        contract = (await db.execute(select(Contract).where(Contract.id == candidate.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
        if (await db.execute(select(PaymentScheduleItem.id).where(PaymentScheduleItem.contract_id == contract.id, finance_desk.ACTIVE_ITEM).limit(1))).first():
            continue
        remaining = contract_finance.client_remaining(contract.amount, await finance_desk.platform_paid(db, contract.id), manual_remaining=contract.client_remaining_amount)
        if not remaining or remaining <= 0 or not contract.client_remaining_date or contract.pipeline_status == PipelineStatus.refund:
            continue
        item = PaymentScheduleItem(
            import_key=f'notion-initial:{contract.id}',
            contract_id=contract.id, student_id=student.id, kind=ScheduleKind.main, label="Остаток из Notion",
            amount=remaining, currency=contract.currency or "KZT", due_date=contract.client_remaining_date,
            note="Перенесено из Notion: «Остаток клиента» и «Остаток клиента (дата)»", created_by=current_user.id,
        )
        db.add(item)
        await db.flush()
        await log_change(db, "payment_schedule_item", item.id, "created", None,
                         f"{item.amount} · {item.due_date.isoformat()}", str(current_user.id), "notion_import")
        created += 1
    await db.commit()
    return {"created": created}


# --------------------------------------------------------------------------- проверка почты


class MailTestIn(BaseModel):
    to: str | None = Field(default=None, max_length=320)


@router.post("/mail-test")
async def mail_test(db: Db, current_user: CurrentUser, body: MailTestIn | None = None):
    """Тестовое письмо (только админ): по ответу видно, что не так с SMTP —
    например, «нужен пароль приложения Google»."""
    from app.services import mail_diagnostics

    require_access(current_user, "users", Action.manage)
    to = (body.to if body and body.to else current_user.email)
    return await mail_diagnostics.send_test(to)


@router.get("/contracts/{contract_id}/documents")
async def contract_documents(contract_id: uuid.UUID, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.view)
    contract = await db.get(Contract, contract_id)
    if contract is None:
        raise HTTPException(404, "Договор не найден")
    from app.api.v1.endpoints.acts import student_acts
    from app.api.v1.endpoints.trustme import _link_dict
    context = await student_acts(contract.student_id, db, current_user)
    links = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id == contract.student_id))).scalars().all()
    linked_ids = {str(c.id) for c in links if c.financial_contract_id == contract_id}
    context["contracts"] = [c for c in context["contracts"] if c["id"] in linked_ids]
    context["acts"] = [a for a in context["acts"] if a["snapshot"].get("contract_link_id") in linked_ids]
    context["unassigned_contracts"] = [_link_dict(c) for c in links if c.financial_contract_id is None]
    choices = (await db.execute(select(Contract).where(Contract.student_id == contract.student_id))).scalars().all()
    context["financial_contracts"] = [{"id": str(c.id), "label": f"{c.signed_date or 'Без даты'} · {c.amount or '—'} {c.currency} · {c.id}"} for c in choices]
    return context


def _delivery_dict(row):
    return {"id": str(row.id), "student_id": str(row.student_id),
            "contract_id": str(row.contract_id) if row.contract_id else None,
            "recipient": row.recipient, "subject": row.subject, "status": row.status,
            "attempts": row.attempts, "last_error": row.last_error,
            "created_at": row.created_at.isoformat()}


@router.get("/mail-deliveries")
async def mail_deliveries(db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.view)
    from app.models.finance_mail import FinanceMailDelivery
    rows = (await db.execute(select(FinanceMailDelivery).order_by(
        FinanceMailDelivery.created_at.desc()).limit(100))).scalars().all()
    return [_delivery_dict(r) for r in rows]


class DeliveryResolution(BaseModel):
    outcome: Literal["sent", "not_sent"]
    note: str = Field(min_length=10, max_length=1000)


@router.post("/mail-deliveries/{delivery_id}/resolve")
async def resolve_delivery(delivery_id: uuid.UUID, body: DeliveryResolution, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.manage)
    from app.models.finance_mail import FinanceMailDelivery
    row = (await db.execute(select(FinanceMailDelivery).where(
        FinanceMailDelivery.id == delivery_id).with_for_update())).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "Отправка не найдена")
    if row.status not in ("unknown", "failed", "sending"):
        raise HTTPException(409, "Эта отправка не требует ручной проверки")
    now = datetime.now(timezone.utc)
    if row.status == "sending" and row.claimed_at and (now - row.claimed_at).total_seconds() < 300:
        raise HTTPException(409, "Отправка ещё выполняется, проверьте позже")
    if len(body.note.strip()) < 10:
        raise HTTPException(422, "Опишите результат проверки")
    old = row.status
    row.status = "sent" if body.outcome == "sent" else "pending"
    row.finished_at = now if body.outcome == "sent" else None
    row.next_attempt_at = now
    # An explicit human retry opens a new 24-hour attempt window.
    if body.outcome == "not_sent":
        row.expires_at = now + timedelta(hours=24)
        row.attempts = 0
    row.last_error = None
    await log_change(db, "student", row.student_id, "finance_mail_resolved", old,
                     f"{row.id}: {row.status}; {body.note.strip()}", str(current_user.id))
    await db.commit()
    return _delivery_dict(row)
