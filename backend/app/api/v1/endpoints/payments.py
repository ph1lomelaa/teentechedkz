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
from app.models.mentor_assignment import MentorAssignment

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


@router.get("/finance-breakdown")
async def finance_breakdown(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)

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
