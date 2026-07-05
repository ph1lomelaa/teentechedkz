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
from app.models.payment import Payment, PaymentType, PaymentStatus
from app.models.contract import Contract
from app.models.student import Student
from app.models.user import UserRole, User

router = APIRouter(prefix="/payments", tags=["payments"])


def _require_admin_mzk(user):
    if user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")


@router.post("")
async def create_payment(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)

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
    _require_admin_mzk(current_user)
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
    _require_admin_mzk(current_user)

    contracts_result = await db.execute(
        select(
            func.count(Contract.id).label("total_contracts"),
            func.sum(Contract.amount).label("total_amount"),
            func.sum(Contract.client_remaining_amount).label("total_remaining"),
        )
    )
    row = contracts_result.one()

    paid_result = await db.execute(
        select(func.sum(Payment.amount)).where(
            Payment.type == PaymentType.client_payment,
            Payment.status == PaymentStatus.paid,
        )
    )
    total_paid = paid_result.scalar() or Decimal("0")

    return {
        "total_contracts": row.total_contracts or 0,
        "total_amount": str(row.total_amount or 0),
        "total_paid": str(total_paid),
        "total_remaining": str(row.total_remaining or 0),
    }


@router.get("/mentor-payouts")
async def mentor_payouts(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)

    result = await db.execute(
        select(
            Payment.mentor_id,
            func.sum(Payment.amount).filter(Payment.status == PaymentStatus.paid).label("paid"),
            func.sum(Payment.amount).filter(Payment.status == PaymentStatus.to_be_paid).label("to_be_paid"),
        )
        .where(Payment.type == PaymentType.mentor_payout, Payment.mentor_id.isnot(None))
        .group_by(Payment.mentor_id)
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
        }
        for r in rows
    ]


@router.get("/client-balances")
async def client_balances(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)

    result = await db.execute(
        select(
            Student.id.label("student_id"),
            Student.full_name,
            Student.intake_year,
            Student.degree_level,
            Contract.pipeline_status,
            Contract.currency,
            func.sum(Contract.client_remaining_amount).label("remaining"),
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
