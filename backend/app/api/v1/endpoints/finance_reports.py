"""«Отчёты» раздела «Финансы» и закрытие месяца (задание 12 плана 14.11.2026).

Все цифры считаются из одной модели: договор (сумма и остаток — из Notion),
оплаты платформы с распределением по графику, возвраты, график. Итоги
сходятся между отчётами: дебиторка по срокам в сумме = остаток к оплате
по графику, долг не бывает больше остатка.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.contract import Contract
from app.models.document import Document
from app.models.finance import FinanceChangeEvent, FinanceClosedMonth, PaymentScheduleItem
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.student import Student
from app.models.user import User, UserRole
from app.services import finance_desk

router = APIRouter(prefix="/finance/reports", tags=["finance"])
Db = Annotated[AsyncSession, Depends(get_db)]
ZERO = Decimal("0")
CLOSED = ("completed_admitted", "changed_mind", "lost_applicant", "refund", "transferred_pipeline")
KIND_LABELS = {"main": "Основной", "english": "Английский", "portfolio": "Улучшение портфолио",
               "proforientation": "Профориентация", "ielts_fee": "Экзамен IELTS", "other": "Другое"}
METHOD_LABELS = {"kaspi": "Kaspi", "bank": "Банк", "cash": "Наличные", "other": "Другое", None: "Не указан"}


def _today() -> date:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("Asia/Almaty")).date()


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _next_month(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


async def _active_contracts(db: AsyncSession):
    return (await db.execute(
        select(Contract, Student, User.name).join(Student, Student.id == Contract.student_id)
        .outerjoin(User, User.id == Contract.mzk_manager_id).where(Student.is_archived.is_(False))
    )).all()


async def _paid_by_contract(db: AsyncSession, ids) -> dict:
    if not ids:
        return {}
    out: dict = {}
    for cid, kind, total in (await db.execute(
        select(Payment.contract_id, Payment.type, func.sum(Payment.amount))
        .where(Payment.contract_id.in_(ids), Payment.status == PaymentStatus.paid,
               Payment.type.in_((PaymentType.client_payment, PaymentType.client_refund)))
        .group_by(Payment.contract_id, Payment.type)
    )).all():
        sign = -1 if kind == PaymentType.client_refund else 1
        out[cid] = out.get(cid, ZERO) + sign * (total or ZERO)
    return out


@router.get("/summary")
async def summary(db: Db, current_user: CurrentUser):
    """Сводка: сумма договоров, оплачено, остаток (Notion и по оплатам), в том
    числе просрочено, в том числе ждёт оффера. Только тенге (решение 9)."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    rows = await _active_contracts(db)
    live = [(c, s, m) for c, s, m in rows if not c.pipeline_status or c.pipeline_status.value not in CLOSED]
    paid = await _paid_by_contract(db, [c.id for c, _, _ in live])
    items = await finance_desk.load_items(db, today=today, contract_id=None,
                                          where=[PaymentScheduleItem.contract_id.in_([c.id for c, _, _ in live])]) if live else []
    overdue = sum((r.item.amount - r.paid for r in items if r.state is finance_desk.ItemState.overdue), ZERO)
    after_offer = sum((r.item.amount - r.paid for r in items if r.state is finance_desk.ItemState.after_offer), ZERO)
    amount = sum((c.amount or ZERO for c, _, _ in live), ZERO)
    notion_remaining = sum((c.client_remaining_amount or ZERO for c, _, _ in live), ZERO)
    recorded = sum(paid.values(), ZERO)
    return {
        "contracts": len(live), "amount": str(amount), "paid_by_notion": str(amount - notion_remaining),
        "recorded_paid": str(recorded), "remaining_notion": str(notion_remaining),
        "overdue": str(overdue), "after_offer": str(after_offer),
        "without_amount": sum(1 for c, _, _ in live if c.amount is None),
    }


@router.get("/income")
async def income(db: Db, current_user: CurrentUser, date_from: date = Query(...), date_to: date = Query(...),
                 by: Literal["none", "kind", "method", "mzk"] = "none"):
    """Поступления по месяцам: план по графику / факт / возвраты / чистыми.
    Разрезы: услуга (вид платежа графика), способ оплаты, МЗК."""
    require_access(current_user, "finance_desk", Action.view)
    if (date_to - date_from).days > 800:
        raise HTTPException(400, "Период не больше двух лет")
    months: dict[tuple, dict] = {}

    def row(month: date, key: str) -> dict:
        return months.setdefault((month, key), {"month": month.isoformat()[:7], "group": key,
                                                "plan": ZERO, "fact": ZERO, "refunds": ZERO})
    plan_q = (select(PaymentScheduleItem.due_date, PaymentScheduleItem.amount, PaymentScheduleItem.kind, User.name)
              .join(Contract, Contract.id == PaymentScheduleItem.contract_id)
              .outerjoin(User, User.id == Contract.mzk_manager_id)
              .where(finance_desk.ACTIVE_ITEM, PaymentScheduleItem.due_date >= date_from, PaymentScheduleItem.due_date <= date_to))
    for due, amount, kind, mzk in (await db.execute(plan_q)).all():
        key = KIND_LABELS.get(kind.value, kind.value) if by == "kind" else (mzk or "МЗК не назначен") if by == "mzk" else "Все" if by != "method" else "—"
        if by == "method":
            continue  # у плана нет способа оплаты
        row(_month_start(due), key)["plan"] += amount
    pay_q = (select(Payment.paid_at, Payment.amount, Payment.type, Payment.method, User.name, PaymentScheduleItem.kind)
             .join(Contract, Contract.id == Payment.contract_id)
             .outerjoin(User, User.id == Contract.mzk_manager_id)
             .outerjoin(PaymentScheduleItem, PaymentScheduleItem.id == Payment.schedule_item_id)
             .where(Payment.status == PaymentStatus.paid, Payment.type.in_((PaymentType.client_payment, PaymentType.client_refund)),
                    Payment.paid_at >= date_from, Payment.paid_at <= date_to))
    for paid_at, amount, ptype, method, mzk, kind in (await db.execute(pay_q)).all():
        if by == "kind":
            key = KIND_LABELS.get(kind.value, kind.value) if kind else "Вне графика"
        elif by == "method":
            key = METHOD_LABELS.get(method.value if method else None)
        elif by == "mzk":
            key = mzk or "МЗК не назначен"
        else:
            key = "Все"
        r = row(_month_start(paid_at), key)
        if ptype == PaymentType.client_refund:
            r["refunds"] += amount
        else:
            r["fact"] += amount
    out = sorted(months.values(), key=lambda r: (r["month"], r["group"]))
    for r in out:
        r["net"] = str(r["fact"] - r["refunds"])
        r["plan"], r["fact"], r["refunds"] = str(r["plan"]), str(r["fact"]), str(r["refunds"])
    return {"rows": out}


BUCKETS = ["Не наступило", "1–30 дней", "31–60 дней", "61–90 дней", "Более 90 дней"]


def _bucket(due: date | None, today: date) -> str:
    if due is None or due >= today:
        return "Не наступило"
    days = (today - due).days
    return "1–30 дней" if days <= 30 else "31–60 дней" if days <= 60 else "61–90 дней" if days <= 90 else "Более 90 дней"


@router.get("/aging")
async def aging(db: Db, current_user: CurrentUser, by: Literal["none", "mzk", "kind"] = "none"):
    """Дебиторка по срокам: неоплаченный остаток строк графика (не больше их
    суммы) — не наступило / 1–30 / 31–60 / 61–90 / более 90 дней. Количество
    и сумма, по МЗК и по услугам."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    rows = await finance_desk.load_items(db, today=today)
    open_rows = [r for r in rows if r.item.amount - r.paid > 0]
    mzk = dict((await db.execute(select(Contract.id, User.name).outerjoin(User, User.id == Contract.mzk_manager_id))).all())
    table: dict[str, dict] = {}
    for r in open_rows:
        if by == "mzk":
            key = mzk.get(r.item.contract_id) or "МЗК не назначен"
        elif by == "kind":
            key = KIND_LABELS.get(r.item.kind.value, r.item.kind.value)
        else:
            key = "Все"
        line = table.setdefault(key, {"group": key, **{b: {"count": 0, "total": ZERO} for b in BUCKETS}})
        cell = line[_bucket(r.item.due_date, today)]
        cell["count"] += 1
        cell["total"] += r.item.amount - r.paid
    out = []
    for line in sorted(table.values(), key=lambda x: x["group"]):
        out.append({"group": line["group"], "buckets": [{"bucket": b, "count": line[b]["count"], "total": str(line[b]["total"])} for b in BUCKETS],
                    "total": str(sum((line[b]["total"] for b in BUCKETS), ZERO))})
    return {"buckets": BUCKETS, "rows": out, "total": str(sum((Decimal(r["total"]) for r in out), ZERO))}


@router.get("/offers")
async def offers(db: Db, current_user: CurrentUser, date_from: date = Query(...), date_to: date = Query(...)):
    """Офферы за период: сколько, по скольким выставлен остаток, сколько
    собрано, средний срок от оффера до первой оплаты после него."""
    require_access(current_user, "finance_desk", Action.view)
    start = datetime.combine(date_from, datetime.min.time(), tzinfo=timezone.utc)
    end = datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    events = (await db.execute(select(FinanceChangeEvent).where(
        FinanceChangeEvent.field == finance_desk.OFFER_FIELD, FinanceChangeEvent.created_at >= start,
        FinanceChangeEvent.created_at < end, FinanceChangeEvent.contract_id.is_not(None)))).scalars().all()
    by_contract: dict = {}
    for e in events:
        by_contract.setdefault(e.contract_id, e)
    issued = sum(1 for e in by_contract.values() if e.status != finance_desk.FinanceChangeStatus.new)
    collected, delays = 0, []
    for cid, e in by_contract.items():
        first = (await db.execute(select(func.min(Payment.paid_at)).where(
            Payment.contract_id == cid, Payment.type == PaymentType.client_payment, Payment.status == PaymentStatus.paid,
            Payment.paid_at >= e.created_at.date()))).scalar_one_or_none()
        if first:
            collected += 1
            delays.append((first - e.created_at.date()).days)
    return {"offers": len(events), "contracts": len(by_contract), "issued": issued, "collected": collected,
            "avg_days_to_payment": round(sum(delays) / len(delays), 1) if delays else None}


# --------------------------------------------------------------------------- закрытие месяца


def _month(value: str) -> date:
    try:
        return date.fromisoformat(f"{value}-01")
    except ValueError:
        raise HTTPException(422, "Месяц в виде ГГГГ-ММ")


async def is_closed(db: AsyncSession, day: date | None) -> bool:
    if day is None:
        return False
    return (await db.get(FinanceClosedMonth, _month_start(day))) is not None


@router.get("/months/{month}")
async def month_status(month: str, db: Db, current_user: CurrentUser):
    """Оплаты месяца для сверки с выпиской: по способам, сверено / нет, без чека."""
    require_access(current_user, "finance_desk", Action.view)
    m = _month(month)
    rows = (await db.execute(
        select(Payment, Student.full_name).join(Contract, Contract.id == Payment.contract_id)
        .join(Student, Student.id == Contract.student_id)
        .where(Payment.status == PaymentStatus.paid, Payment.type.in_((PaymentType.client_payment, PaymentType.client_refund)),
               Payment.paid_at >= m, Payment.paid_at < _next_month(m))
        .order_by(Payment.paid_at, Student.full_name)
    )).all()
    receipts = set((await db.execute(select(Document.payment_id).where(
        Document.payment_id.in_([p.id for p, _ in rows])))).scalars().all()) if rows else set()
    by_method: dict[str, Decimal] = {}
    for p, _ in rows:
        key = METHOD_LABELS.get(p.method.value if p.method else None)
        by_method[key] = by_method.get(key, ZERO) + (-p.amount if p.type == PaymentType.client_refund else p.amount)
    closed = await db.get(FinanceClosedMonth, m)
    closer = await db.get(User, closed.closed_by) if closed and closed.closed_by else None
    return {
        "month": month, "closed_at": closed.closed_at.isoformat() if closed else None, "closed_by": closer.name if closer else None,
        "by_method": [{"method": k, "total": str(v)} for k, v in sorted(by_method.items())],
        "payments": [{"id": str(p.id), "contract_id": str(p.contract_id), "student_name": n, "paid_at": p.paid_at.isoformat(),
                      "amount": str(p.amount), "refund": p.type == PaymentType.client_refund,
                      "method": p.method.value if p.method else None, "has_receipt": p.id in receipts,
                      "reconciled": p.reconciled_at is not None} for p, n in rows],
        "unreconciled": sum(1 for p, _ in rows if p.reconciled_at is None),
        "no_receipt": sum(1 for p, _ in rows if p.type == PaymentType.client_payment and p.id not in receipts),
    }


class ReconcileIn(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=2000)
    reconciled: bool = True


@router.post("/reconcile")
async def reconcile(body: ReconcileIn, db: Db, current_user: CurrentUser):
    """«Сверено с выпиской» — массово. В закрытом месяце — только админ."""
    require_access(current_user, "finance_desk", Action.manage)
    payments = (await db.execute(select(Payment).where(Payment.id.in_(body.ids)))).scalars().all()
    now = datetime.now(timezone.utc)
    for p in payments:
        if await is_closed(db, p.paid_at) and current_user.role != UserRole.admin:
            raise HTTPException(409, "Месяц закрыт: менять сверку может только админ")
        p.reconciled_at = now if body.reconciled else None
        p.reconciled_by = current_user.id if body.reconciled else None
    await db.commit()
    return {"updated": len(payments)}


class CloseIn(BaseModel):
    force: bool = False
    note: str | None = Field(default=None, max_length=500)


@router.post("/months/{month}/close")
async def close_month(month: str, body: CloseIn, db: Db, current_user: CurrentUser):
    """«Закрыть месяц»: нельзя, пока есть несверенные оплаты или оплаты без
    чека, — если не подтвердить «Закрыть всё равно». После закрытия оплаты
    месяца меняет только админ с причиной."""
    require_access(current_user, "finance_desk", Action.manage)
    m = _month(month)
    if m >= _month_start(_today()):
        raise HTTPException(409, "Закрыть можно только прошедший месяц")
    if await db.get(FinanceClosedMonth, m):
        raise HTTPException(409, "Месяц уже закрыт")
    status = await month_status(month, db, current_user)
    if (status["unreconciled"] or status["no_receipt"]) and not body.force:
        raise HTTPException(409, f"Не сверено оплат: {status['unreconciled']}, без чека: {status['no_receipt']}. Закрыть всё равно?",
                            headers={"X-Error-Code": "MONTH_NOT_READY"})
    db.add(FinanceClosedMonth(month=m, closed_by=current_user.id, note=body.note))
    await log_change(db, "finance_month", uuid.uuid5(uuid.NAMESPACE_URL, month), "closed", None, month, str(current_user.id))
    await db.commit()
    return {"month": month, "closed": True}
