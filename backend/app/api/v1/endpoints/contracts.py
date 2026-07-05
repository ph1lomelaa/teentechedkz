from __future__ import annotations
import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.models.contract import Contract, PipelineStatus, PaymentPlan
from app.models.user import UserRole
from app.schemas.contract import ContractCreate, ContractUpdate

router = APIRouter(prefix="/contracts", tags=["contracts"])

HUMAN_ONLY_FIELDS = {"iin", "amount", "note_text", "pipeline_status_refund", "pipeline_status_changed_mind"}


@router.post("")
async def create_contract(
    body: ContractCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)

    contract = Contract(
        student_id=body.student_id,
        signed_date=body.signed_date,
        amount=body.amount,
        currency=body.currency,
        payment_plan=body.payment_plan,
        pipeline_status=body.pipeline_status,
        mzk_manager_id=body.mzk_manager_id,
        ielts_payment_included=body.ielts_payment_included,
        english_sum=body.english_sum,
        english_paid=body.english_paid,
        client_remaining_amount=body.client_remaining_amount,
        client_remaining_date=body.client_remaining_date,
        mentor_total_owed=body.mentor_total_owed,
        notes=body.notes,
    )
    db.add(contract)
    await db.flush()
    await log_change(db, "contract", contract.id, "created", None, str(pipeline_status.value), str(current_user.id))
    await db.commit()
    contract = await _load_contract(db, contract.id)
    return _contract_to_dict(contract)


@router.patch("/{contract_id}")
async def update_contract(
    contract_id: uuid.UUID,
    body: ContractUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)

    result = await db.execute(select(Contract).where(Contract.id == contract_id))
    contract = result.scalar_one_or_none()
    if not contract:
        raise HTTPException(status_code=404, detail="Договор не найден")

    updates = body.model_dump(exclude_unset=True)

    if "pipeline_status" in updates:
        new_ps = updates["pipeline_status"]
        if new_ps in (PipelineStatus.refund, PipelineStatus.changed_mind) and current_user.role != UserRole.admin:
            raise HTTPException(
                status_code=403,
                detail="Смена статуса на 'refund'/'changed_mind' — только для admin",
                headers={"X-Error-Code": "HUMAN_ONLY_FIELD"},
            )
        old_ps = contract.pipeline_status.value
        if old_ps != new_ps.value:
            await log_change(db, "contract", contract.id, "pipeline_status", old_ps, new_ps.value, str(current_user.id))
        contract.pipeline_status = new_ps

    if "amount" in updates and updates["amount"] is not None:
        await log_change(db, "contract", contract.id, "amount", str(contract.amount), str(updates["amount"]), str(current_user.id))
        contract.amount = updates["amount"]

    for field in ["notes", "ielts_payment_included", "english_sum", "english_paid",
                  "client_remaining_amount", "client_remaining_date", "mentor_total_owed",
                  "mzk_manager_id", "payment_plan", "signed_date", "currency"]:
        if field in updates:
            setattr(contract, field, updates[field])

    await db.commit()
    contract = await _load_contract(db, contract.id)
    return _contract_to_dict(contract)


@router.get("/student/{student_id}")
async def get_contracts_for_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_admin_mzk(current_user)
    result = await db.execute(
        select(Contract)
        .options(joinedload(Contract.mzk_manager))
        .where(Contract.student_id == student_id)
        .order_by(Contract.created_at.desc())
    )
    contracts = result.scalars().all()
    return [_contract_to_dict(c) for c in contracts]


async def _load_contract(db: AsyncSession, contract_id: uuid.UUID) -> Contract:
    result = await db.execute(
        select(Contract).options(joinedload(Contract.mzk_manager)).where(Contract.id == contract_id)
    )
    return result.scalar_one()


def _require_admin_mzk(user):
    if user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")


def _optional_update(obj, body: dict, field: str):
    if field in body:
        setattr(obj, field, body[field])


def _parse_date(val) -> date | None:
    if not val:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except Exception:
        return None


def _contract_to_dict(c: Contract) -> dict:
    return {
        "id": str(c.id),
        "student_id": str(c.student_id),
        "signed_date": c.signed_date.isoformat() if c.signed_date else None,
        "amount": str(c.amount) if c.amount else None,
        "currency": c.currency,
        "payment_plan": c.payment_plan.value if c.payment_plan else None,
        "pipeline_status": c.pipeline_status.value if c.pipeline_status else None,
        "mzk_manager_id": str(c.mzk_manager_id) if c.mzk_manager_id else None,
        "mzk_manager_name": c.mzk_manager.name if c.mzk_manager else None,
        "ielts_payment_included": c.ielts_payment_included,
        "english_sum": str(c.english_sum) if c.english_sum else None,
        "english_paid": str(c.english_paid) if c.english_paid else None,
        "client_remaining_amount": str(c.client_remaining_amount) if c.client_remaining_amount else None,
        "client_remaining_date": c.client_remaining_date.isoformat() if c.client_remaining_date else None,
        "mentor_total_owed": str(c.mentor_total_owed) if c.mentor_total_owed else None,
        "notes": c.notes,
        "created_at": c.created_at.isoformat(),
    }
