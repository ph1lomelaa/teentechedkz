"""Раздел «Финансы»: сегодня, платежи, договоры, проверка.

Смотрит управление (finance_desk:view), ведут финансист и админ
(finance_desk:manage). Старый раздел /payments остаётся как был — здесь
другая единица учёта: ожидаемый платёж по графику, а не договор целиком.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.uploads import read_upload_capped
from app.models.contract import Contract, PipelineStatus
from app.models.trustme_contract import TrustMeContractLink
from app.models.service_act import ServiceAct
from typing import Literal
from app.models.document import DocSource, DocType, Document
from app.models.finance import FinanceChangeEvent, FinanceChangeStatus, PaymentScheduleItem, ScheduleKind
from app.models.notification import Notification
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
from app.models.payment import Payment, PaymentMethod, PaymentStatus, PaymentType
from app.models.student import Student
from app.models.user import User
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


async def _items(db: AsyncSession, today: date, *where, contract_id: uuid.UUID | None = None) -> list[dict]:
    rows = await finance_desk.load_items(db, today=today, where=list(where), contract_id=contract_id)
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
        select(Payment.contract_id, func.sum(Payment.amount))
        .where(Payment.contract_id.in_(contract_ids), Payment.type == PaymentType.client_payment,
               Payment.status == PaymentStatus.paid)
        .group_by(Payment.contract_id)
    )).all()
    return {cid: total or Decimal("0") for cid, total in rows}


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
        )
    return out


def _next_payment(money: ContractMoney, today: date) -> dict:
    """Что показать в колонке «Следующий платёж»."""
    if money.next_item is not None:
        state = money.next_item["state"]
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
               Contract.id.in_(select(PaymentScheduleItem.contract_id)))
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


def _payment_dict(p: Payment, student_name: str, recorder: str | None, item: PaymentScheduleItem | None, has_receipt: bool) -> dict:
    return {
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


async def _new_changes_count(db: AsyncSession) -> int:
    return (await db.execute(
        select(func.count(FinanceChangeEvent.id)).where(FinanceChangeEvent.status == FinanceChangeStatus.new)
    )).scalar_one()


# --------------------------------------------------------------------------- сегодня


@router.get("/today")
async def today_view(db: Db, current_user: CurrentUser):
    """«Сегодня» — список дел: оплаты на сегодня, просрочка, правки из Notion."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    month_start, month_end = _month_bounds(today)
    due_today = await _items(db, today, PaymentScheduleItem.due_date == today)
    overdue = [i for i in await _items(db, today, PaymentScheduleItem.due_date < today) if i["state"] == "overdue"]
    overdue.sort(key=lambda i: -i["days_overdue"])
    received_by_currency = dict((await db.execute(
        select(Payment.currency, func.sum(Payment.amount)).join(Contract, Contract.id == Payment.contract_id)
        .join(Student, Student.id == Contract.student_id)
        .where(Student.is_archived.is_(False), Payment.type == PaymentType.client_payment,
               Payment.status == PaymentStatus.paid, Payment.paid_at >= month_start, Payment.paid_at < month_end)
        .group_by(Payment.currency))).all())
    planned_by_currency = dict((await db.execute(
        select(PaymentScheduleItem.currency, func.sum(PaymentScheduleItem.amount))
        .join(Student, Student.id == PaymentScheduleItem.student_id)
        .where(Student.is_archived.is_(False), PaymentScheduleItem.due_date >= month_start,
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
    }


@router.get("/counters")
async def counters(db: Db, current_user: CurrentUser):
    """Числа для меню. «Проверка» — непроверенные правки + оплаты без чека.
    Непрочитанные уведомления считает колокольчик."""
    require_access(current_user, "finance_desk", Action.view)
    today = _today()
    rows = await finance_desk.load_items(db, today=today, where=[PaymentScheduleItem.due_date <= today])
    new_changes = await _new_changes_count(db)
    no_receipt = len(await _payments_without_receipt(db))
    # Расхождения графика в счётчик не входят: пока графики заводятся, их
    # сотни, и цифра в меню перестала бы что-то значить. Они — фильтр
    # в «Договорах».
    return {
        "due_today": sum(1 for r in rows if r.state is ItemState.today),
        "overdue": sum(1 for r in rows if r.state is ItemState.overdue),
        "new_changes": new_changes,
        "no_receipt": no_receipt,
        "review": new_changes + no_receipt,
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
    due_date: date
    note: str | None = None


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
    return (await _items(db, _today(), PaymentScheduleItem.id == item.id))[0]


@router.post("/schedule", status_code=201)
async def create_item(body: ScheduleItemIn, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.manage)
    contract = (await db.execute(select(Contract).where(Contract.id == body.contract_id).with_for_update())).scalar_one_or_none()
    if contract is None:
        raise HTTPException(status_code=404, detail="Договор не найден")
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
        created_by=current_user.id,
    )
    db.add(item)
    await db.flush()
    await log_change(db, "payment_schedule_item", item.id, "created", None,
                     f"{item.amount} · {item.due_date.isoformat()}", str(current_user.id))
    await db.commit()
    return await _item_dict(db, item)


@router.patch("/schedule/{item_id}")
async def update_item(item_id: uuid.UUID, body: ScheduleItemPatch, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    await db.execute(select(Contract.id).where(Contract.id == item.contract_id).with_for_update())
    await db.refresh(item)
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


@router.delete("/schedule/{item_id}", status_code=204)
async def delete_item(item_id: uuid.UUID, db: Db, current_user: CurrentUser):
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    await db.execute(select(Contract.id).where(Contract.id == item.contract_id).with_for_update())
    paid = (await finance_desk.paid_by_item(db, [item.id])).get(item.id, Decimal("0"))
    if paid > 0:
        raise HTTPException(status_code=409, detail="По платежу уже есть оплата — удалить нельзя, измените сумму")
    await log_change(db, "payment_schedule_item", item.id, "deleted",
                     f"{item.amount} · {item.due_date.isoformat()}", None, str(current_user.id))
    contract_id = item.contract_id
    await db.delete(item)
    await db.flush()
    await db.commit()


class AllocatePaymentIn(BaseModel):
    schedule_item_id: uuid.UUID


@router.post('/payments/{payment_id}/allocate')
async def allocate_payment(payment_id: uuid.UUID, body: AllocatePaymentIn, db: Db, current_user: CurrentUser):
    require_access(current_user, 'finance_desk', Action.manage)
    payment = await db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(404, 'Оплата не найдена')
    contract = (await db.execute(select(Contract).where(Contract.id == payment.contract_id).with_for_update())).scalar_one()
    await db.refresh(payment)
    if payment.type != PaymentType.client_payment or payment.status != PaymentStatus.paid:
        raise HTTPException(409, 'К графику привязывается только полученная оплата клиента')
    if payment.schedule_item_id:
        if payment.schedule_item_id == body.schedule_item_id:
            return {'ok': True}
        raise HTTPException(409, 'Оплата уже привязана к графику')
    item = await _load_item(db, body.schedule_item_id)
    if item.contract_id != contract.id or item.currency != payment.currency:
        raise HTTPException(422, 'Выберите платёж того же договора и в той же валюте')
    paid = (await finance_desk.paid_by_item(db, [item.id])).get(item.id, Decimal('0'))
    if payment.amount > item.amount - paid:
        raise HTTPException(409, 'Оплата превышает неоплаченный остаток строки графика')
    payment.schedule_item_id = item.id
    await log_change(db, 'payment', payment.id, 'schedule_item_id', None, str(item.id), str(current_user.id))
    # Личная отметка финансиста: остаток договора и Notion не трогаем.
    await db.commit()
    return {'ok': True}


class PayIn(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2)
    paid_at: date
    method: PaymentMethod
    note: str | None = Field(default=None, max_length=500)


@router.post("/schedule/{item_id}/pay", status_code=201)
async def pay_item(item_id: uuid.UUID, body: PayIn, db: Db, current_user: CurrentUser):
    """Отметить оплату. Сумма меньше ожидаемой — частичная оплата: строка
    остаётся открытой на разницу и видна в просроченных, если срок прошёл."""
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    contract = (await db.execute(select(Contract).where(Contract.id == item.contract_id).with_for_update())).scalar_one()
    # The contract lock serializes partial payments and balance changes.
    await db.refresh(item)
    paid = (await finance_desk.paid_by_item(db, [item.id])).get(item.id, Decimal('0'))
    if body.amount > item.amount - paid:
        raise HTTPException(409, 'Сумма превышает неоплаченный остаток платежа. Обновите график перед сохранением.')
    if body.paid_at > _today():
        raise HTTPException(status_code=400, detail="Дата оплаты не может быть в будущем")
    payment = Payment(
        contract_id=item.contract_id, type=PaymentType.client_payment, amount=body.amount,
        currency=item.currency, status=PaymentStatus.paid, paid_at=body.paid_at,
        recorded_by=current_user.id, note=body.note, schedule_item_id=item.id, method=body.method,
    )
    db.add(payment)
    await db.flush()
    await log_change(db, "payment", payment.id, "created", None,
                     f"{payment.amount} · {body.method.value} · график {item.id}", str(current_user.id))
    # Отметка — для самого финансиста: остаток договора не меняется, в Notion
    # и ученику ничего не уходит (решение 06.11.2026).
    await db.commit()
    # payment_id нужен фронту, чтобы приложить чек к этому платежу.
    return {**await _item_dict(db, item), "payment_id": str(payment.id)}


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
    """Напомнить МЗК ученика о просроченном платеже. Не чаще раза в день."""
    require_access(current_user, "finance_desk", Action.manage)
    item = await _load_item(db, item_id)
    contract = await db.get(Contract, item.contract_id)
    student = await db.get(Student, item.student_id)
    if contract is None or contract.mzk_manager_id is None:
        raise HTTPException(status_code=409, detail="У договора не указан МЗК — напоминать некому")
    marker = f"[schedule:{item.id}:{_today().isoformat()}]"
    if await was_sent(db, contract.mzk_manager_id, kind="payment_overdue", body_contains=marker):
        return {"ok": True, "already_sent": True}
    days = (_today() - item.due_date).days
    text = f"Платёж {item.amount:,.0f} ₸ со сроком {item.due_date.strftime('%d.%m.%Y')}".replace(",", " ")
    if days > 0:
        text += f" просрочен на {days} дн."
    notify(db, contract.mzk_manager_id, kind="payment_overdue",
           title=f"Оплата: {student.full_name if student else 'ученик'}",
           body=f"{text} {marker}", link=f"/students/{item.student_id}", priority="high")
    await db.commit()
    return {"ok": True, "already_sent": False}


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
        stmt = stmt.where(Student.full_name.ilike(f"%{q.strip()}%"))
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
        stmt = stmt.where(~Contract.id.in_(select(PaymentScheduleItem.contract_id)))
    if schedule == "mismatch":
        # Расхождение считается в Python: остаток зависит от правила
        # contract_finance, повторять его в SQL — второе место для ошибки.
        candidates = (await db.execute(stmt.where(Contract.id.in_(select(PaymentScheduleItem.contract_id))))).all()
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
        "items": [{**_contract_row(c, s, mzk_name, money[c.id], today), "trustme_count": document_counts.get(c.id, 0),
                   "acts_count": act_counts.get(c.id, 0), **_coverage_brief(covered.get(c.id)),
                   "originals": originals[c.id]} for c, s, mzk_name in rows],
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
    if contract is None or doc is None or doc.student_id != contract.student_id or doc.doc_type != DocType.contract_scan:
        raise HTTPException(404, "Скан договора не найден")
    content = await minio_download(doc.storage_path)
    inline = doc.mime_type in {"application/pdf", "image/jpeg", "image/png", "image/webp"}
    name = doc.display_name or doc.file_name or "Договор"
    return Response(content, media_type=doc.mime_type if inline else "application/octet-stream", headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="contract"; filename*=UTF-8\'\'{quote(name)}',
        "X-Content-Type-Options": "nosniff",
    })


def _coverage_brief(row) -> dict:
    """Договор TrustMe и закрытие услуг актами — для строки и карточки финансиста."""
    row = row or {"contracts": [], "services_total": 0, "services_closed": 0, "percent": None}
    return {"trustme": [{"id": c["id"], "number": c["number"], "status": c["status"], "source": c["source"]} for c in row["contracts"]],
            "services_total": row["services_total"], "services_closed": row["services_closed"], "closed_percent": row["percent"]}


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
        .where(Payment.contract_id == c.id, Payment.type == PaymentType.client_payment, Payment.status == PaymentStatus.paid)
        .order_by(Payment.paid_at.desc().nulls_last())
    )).all()
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
        "signed_date": c.signed_date.isoformat() if c.signed_date else None,
        "source": "Notion" if snapshot else "Платформа",
        "synced_at": snapshot.synced_at.isoformat() if snapshot and snapshot.synced_at else None,
        "scheduled": str(money.scheduled_open),
        "undistributed": str(money.undistributed) if money.undistributed is not None else None,
        "schedule": await _items(db, today, contract_id=c.id),
        "payments": [_payment_dict(p, student.full_name, recorder, item, p.id in with_receipt)
                     for p, recorder, item in payments],
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
        .order_by((FinanceChangeEvent.status == FinanceChangeStatus.new).desc(), FinanceChangeEvent.created_at.desc(), FinanceChangeEvent.id))
    if status == 'new':
        stmt = stmt.where(FinanceChangeEvent.status == FinanceChangeStatus.new)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    pending_total = await _new_changes_count(db)
    events = (await db.execute(stmt.offset(offset).limit(limit))).all()
    return {
        "total": total, "pending_total": pending_total, "offset": offset, "limit": limit,
        "changes": [finance_desk.change_to_dict(e, name, resolver, mzk, who) for e, name, resolver, mzk, who in events],
        "no_receipt": await _payments_without_receipt(db),
        "discrepancies": await _discrepancies(db, _today()),
    }


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
        if (await db.execute(select(PaymentScheduleItem.id).where(PaymentScheduleItem.contract_id == contract.id).limit(1))).first():
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
