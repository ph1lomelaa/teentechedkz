from __future__ import annotations
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.payment import Payment, PaymentType, PaymentStatus
from app.models.contract import Contract
from app.models.student import Student
from app.models.user import UserRole, User
from app.models.mentor_assignment import MentorAssignment
from app.core.config import settings
from datetime import timedelta
from app.models.document import Document
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"])


@router.get("")
async def list_payments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    result = await db.execute(
        select(Payment, Student.id, Student.full_name)
        .join(Contract, Contract.id == Payment.contract_id)
        .join(Student, Student.id == Contract.student_id)
        .order_by(Payment.paid_at.desc().nulls_last())
    )
    rows = result.all()

    return [
        {
            **_payment_to_dict(p),
            "student_id": str(student_id),
            "student_name": student_name,
        }
        for p, student_id, student_name in rows
    ]


@router.post("")
async def create_payment(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.manage)

    try:
        ptype = PaymentType(body["type"])
        pstatus = PaymentStatus(body["status"])
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    p = Payment(
        contract_id=uuid.UUID(body["contract_id"]),
        type=ptype,
        amount=Decimal(str(body["amount"])),
        currency=body.get("currency", "KZT"),
        status=pstatus,
        paid_at=date.fromisoformat(body["paid_at"]) if body.get("paid_at") else None,
        mentor_id=uuid.UUID(body["mentor_id"]) if body.get("mentor_id") else None,
        recorded_by=current_user.id,
        note=body.get("note"),
    )
    db.add(p)
    await db.flush()

    # Событийное уведомление менторам+МЗК при записи фактической выплаты ментору.
    if ptype == PaymentType.mentor_payout and pstatus == PaymentStatus.paid:
        try:
            from app.services.payment_notifier import notify_mentor_payout_event
            contract = await db.get(Contract, p.contract_id)
            if contract:
                await notify_mentor_payout_event(db, contract, "payout_recorded", current_user.id)
        except Exception:  # noqa: BLE001 — уведомление не должно ронять запись платежа
            logger.exception("Не удалось создать уведомление о выплате ментору")

    await db.commit()
    await db.refresh(p)
    return _payment_to_dict(p)


@router.patch("/{payment_id}")
async def update_payment(
    payment_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.manage)
    result = await db.execute(select(Payment).where(Payment.id == payment_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(status_code=404, detail="Платёж не найден")

    if "amount" in body:
        p.amount = Decimal(str(body["amount"]))
    if "status" in body:
        try:
            p.status = PaymentStatus(body["status"])
        except ValueError:
            pass
    if "paid_at" in body:
        p.paid_at = date.fromisoformat(body["paid_at"]) if body["paid_at"] else None
    if "note" in body:
        p.note = body["note"]

    await db.commit()
    await db.refresh(p)
    return _payment_to_dict(p)


@router.get("/finance-summary")
async def finance_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    contracts_result = await db.execute(
        select(
            Contract.currency,
            func.count(Contract.id).label("total_contracts"),
            func.sum(Contract.amount).label("total_amount"),
            func.sum(Contract.client_remaining_amount).label("total_remaining"),
            # client_remaining_amount не заполнен для большинства договоров,
            # пока их не подтвердили из Notion вручную или через синк — сумма
            # без этого счётчика выглядит как «весь остаток», хотя на деле
            # это остаток только по know_count из total_contracts договоров.
            func.count(Contract.client_remaining_amount).label("remaining_known_count"),
        ).group_by(Contract.currency)
    )
    contract_rows = contracts_result.all()

    paid_result = await db.execute(
        select(Contract.currency, func.sum(Payment.amount))
        .select_from(Payment)
        .join(Contract, Contract.id == Payment.contract_id)
        .where(
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
        .group_by(Contract.currency)
    )
    paid_by_currency = {r[0]: r[1] or Decimal("0") for r in paid_result.all()}

    by_currency = [
        {
            "currency": r.currency,
            "total_contracts": r.total_contracts or 0,
            "total_amount": str(r.total_amount or 0),
            "total_paid": str(paid_by_currency.get(r.currency, Decimal("0"))),
            "total_remaining": str(r.total_remaining or 0),
            "remaining_known_count": r.remaining_known_count or 0,
        }
        for r in contract_rows
    ]
    # Витрина верхнего уровня показывает валюту с наибольшим числом договоров,
    # остальные валюты доступны в by_currency — суммы разных валют не смешиваем.
    primary = max(by_currency, key=lambda c: c["total_contracts"]) if by_currency else None

    return {
        "total_contracts": primary["total_contracts"] if primary else 0,
        "total_amount": primary["total_amount"] if primary else "0",
        "total_paid": primary["total_paid"] if primary else "0",
        "total_remaining": primary["total_remaining"] if primary else "0",
        "remaining_known_count": primary["remaining_known_count"] if primary else 0,
        "currency": primary["currency"] if primary else "KZT",
        "by_currency": by_currency,
    }


@router.get("/finance-breakdown")
async def finance_breakdown(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    paid_subquery = (
        select(
            Payment.contract_id.label("contract_id"),
            func.sum(Payment.amount).label("paid_amount"),
        )
        .where(
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
        .group_by(Payment.contract_id)
        .subquery()
    )

    manager_name_sq = (
        select(User.name)
        .where(User.id == Contract.mzk_manager_id)
        .correlate(Contract)
        .scalar_subquery()
    )
    mentor_name_sq = (
        select(User.name)
        .select_from(MentorAssignment)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id == Contract.student_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(MentorAssignment.assigned_at.desc())
        .limit(1)
        .correlate(Contract)
        .scalar_subquery()
    )

    result = await db.execute(
        select(
            Contract.id,
            Student.id.label("student_id"),
            Student.full_name,
            Student.intake_year,
            Student.degree_level,
            Contract.pipeline_status,
            Contract.currency,
            Contract.amount,
            Contract.client_remaining_amount,
            manager_name_sq.label("manager_name"),
            mentor_name_sq.label("mentor_name"),
            func.coalesce(paid_subquery.c.paid_amount, 0).label("paid_amount"),
        )
        .join(Student, Student.id == Contract.student_id)
        .outerjoin(paid_subquery, paid_subquery.c.contract_id == Contract.id)
        .order_by(func.coalesce(Contract.client_remaining_amount, 0).desc(), Student.full_name.asc())
    )
    rows = result.all()

    return {
        "contracts": [
            {
                "contract_id": str(r.id),
                "student_id": str(r.student_id),
                "student_name": r.full_name,
                "intake_year": r.intake_year,
                "degree_level": r.degree_level.value,
                "pipeline_status": r.pipeline_status.value if r.pipeline_status else None,
                "currency": r.currency,
                "amount": str(r.amount) if r.amount is not None else None,
                "paid_amount": str(r.paid_amount or 0),
                "remaining_amount": str(r.client_remaining_amount or 0),
                "calculated_remaining_amount": str(
                    Decimal(str(r.amount or 0)) - Decimal(str(r.paid_amount or 0))
                ),
                "manager_name": r.manager_name,
                "mentor_name": r.mentor_name,
                "responsible_name": r.manager_name or r.mentor_name,
                "responsible_role": "manager" if r.manager_name else ("mentor" if r.mentor_name else None),
            }
            for r in rows
        ],
    }


@router.get("/mentor-payouts")
async def mentor_payouts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    result = await db.execute(
        select(
            Payment.mentor_id,
            Payment.currency,
            func.sum(Payment.amount).filter(Payment.status == PaymentStatus.paid).label("paid"),
            func.sum(Payment.amount).filter(Payment.status == PaymentStatus.to_be_paid).label("to_be_paid"),
        )
        .where(Payment.type == PaymentType.mentor_payout, Payment.mentor_id.isnot(None))
        .group_by(Payment.mentor_id, Payment.currency)
    )
    rows = result.all()

    mentor_ids = [r.mentor_id for r in rows]
    users_result = await db.execute(select(User).where(User.id.in_(mentor_ids)))
    users = {u.id: u.name for u in users_result.scalars().all()}

    return [
        {
            "mentor_id": str(r.mentor_id),
            "mentor_name": users.get(r.mentor_id, "Unknown"),
            "paid": str(r.paid or 0),
            "to_be_paid": str(r.to_be_paid or 0),
            "currency": r.currency,
        }
        for r in rows
    ]


@router.get("/{payment_id}/documents")
async def payment_documents(
    payment_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    result = await db.execute(
        select(Document).where(Document.payment_id == payment_id).order_by(Document.uploaded_at.desc())
    )
    docs = result.scalars().all()
    return [
        {
            "id": str(d.id),
            "file_name": d.file_name,
            "mime_type": d.mime_type,
            "storage_path": d.storage_path,
            "uploaded_at": d.uploaded_at.isoformat(),
            "student_id": str(d.student_id),
        }
        for d in docs
    ]


@router.get("/client-balances")
async def client_balances(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    manager_name_sq = (
        select(User.name)
        .select_from(Contract)
        .join(User, User.id == Contract.mzk_manager_id)
        .where(
            Contract.student_id == Student.id,
            Contract.mzk_manager_id.isnot(None),
        )
        .order_by(Contract.created_at.desc())
        .limit(1)
        .correlate(Student)
        .scalar_subquery()
    )
    mentor_name_sq = (
        select(User.name)
        .select_from(MentorAssignment)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id == Student.id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(MentorAssignment.assigned_at.desc())
        .limit(1)
        .correlate(Student)
        .scalar_subquery()
    )

    result = await db.execute(
        select(
            Student.id.label("student_id"),
            Student.full_name,
            Student.intake_year,
            Student.degree_level,
            Contract.pipeline_status,
            Contract.currency,
            func.sum(Contract.client_remaining_amount).label("remaining"),
            manager_name_sq.label("manager_name"),
            mentor_name_sq.label("mentor_name"),
        )
        .join(Contract, Contract.student_id == Student.id)
        .where(
            Student.is_archived == False,  # noqa: E712
            Contract.client_remaining_amount.isnot(None),
            Contract.client_remaining_amount > 0,
        )
        .group_by(
            Student.id,
            Student.full_name,
            Student.intake_year,
            Student.degree_level,
            Contract.pipeline_status,
            Contract.currency,
        )
        .order_by(func.sum(Contract.client_remaining_amount).desc())
    )
    rows = result.all()

    return [
        {
            "student_id": str(r.student_id),
            "full_name": r.full_name,
            "intake_year": r.intake_year,
            "degree_level": r.degree_level.value,
            "pipeline_status": r.pipeline_status.value if r.pipeline_status else None,
            "remaining": str(r.remaining or 0),
            "currency": r.currency,
            "responsible_name": r.manager_name or r.mentor_name,
            "responsible_role": "manager" if r.manager_name else ("mentor" if r.mentor_name else None),
        }
        for r in rows
    ]


@router.get("/upcoming")
async def upcoming_payments(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "finances", Action.view)

    look_ahead_days = settings.PAYMENT_DUE_LOOK_AHEAD_DAYS
    threshold_date = date.today() + timedelta(days=look_ahead_days)

    manager_name_sq = (
        select(User.name)
        .where(User.id == Contract.mzk_manager_id)
        .correlate(Contract)
        .scalar_subquery()
    )
    mentor_name_sq = (
        select(User.name)
        .select_from(MentorAssignment)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id == Contract.student_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(MentorAssignment.assigned_at.desc())
        .limit(1)
        .correlate(Contract)
        .scalar_subquery()
    )

    result = await db.execute(
        select(
            Contract.id,
            Student.id.label("student_id"),
            Student.full_name,
            Contract.client_remaining_amount,
            Contract.client_remaining_date,
            Contract.currency,
            manager_name_sq.label("manager_name"),
            mentor_name_sq.label("mentor_name"),
        )
        .join(Student, Student.id == Contract.student_id)
        .where(
            Contract.client_remaining_date.isnot(None),
            Contract.client_remaining_date <= threshold_date,
            Contract.client_remaining_date >= date.today(),
        )
        .order_by(Contract.client_remaining_date.asc())
    )
    rows = result.all()

    return [
        {
            "contract_id": str(r.id),
            "student_id": str(r.student_id),
            "student_name": r.full_name,
            "remaining": float(r.client_remaining_amount) if r.client_remaining_amount is not None else 0.0,
            "currency": r.currency,
            "client_remaining_date": r.client_remaining_date.isoformat() if r.client_remaining_date else None,
            "responsible_name": r.manager_name or r.mentor_name,
            "responsible_role": "manager" if r.manager_name else ("mentor" if r.mentor_name else None),
        }
        for r in rows
    ]


def _payment_to_dict(p: Payment) -> dict:
    return {
        "id": str(p.id),
        "contract_id": str(p.contract_id),
        "type": p.type.value,
        "amount": str(p.amount),
        "currency": p.currency,
        "status": p.status.value,
        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
        "mentor_id": str(p.mentor_id) if p.mentor_id else None,
        "recorded_by": str(p.recorded_by),
        "note": p.note,
    }
