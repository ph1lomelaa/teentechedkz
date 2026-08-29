"""Возвратные кейсы (регламент МЗК, раздел 6) — ручной уровень сложности, без SLA-таймера.

Уровень (жёлтый/оранжевый/красный) утверждается вручную уполномоченным лицом
(admin/mzk_manager) по критериям регламента — не автоматически. Сумма бонуса
берётся из действующей ставки (конструктор вознаграждений, `reward_rules`) и
замораживается в кейсе в момент утверждения уровня, поэтому последующая правка
ставки не меняет уже утверждённые суммы.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.body import optional_uuid, required_uuid
from app.core.audit import log_change
from app.models.refund_case import RefundCase, RefundLevel, RefundCaseStatus
from app.models.user import UserRole
from app.models.reward_rule import RewardRuleKind
from app.services.reward_rules import active_rules, refund_amount_from_payload

router = APIRouter(prefix="/refund-cases", tags=["refund_cases"])


def _require_approved_change_basis(body: dict) -> tuple[str, str]:
    reason = (body.get("change_reason") or "").strip()
    written_approval = (body.get("written_approval") or "").strip()
    if not reason or not written_approval:
        raise HTTPException(
            status_code=409,
            detail="Изменение утверждённого решения требует причины и письменного согласования",
            headers={"X-Error-Code": "REFUND_APPROVED_CHANGE_BASIS_REQUIRED"},
        )
    return reason, written_approval


def _to_dict(c: RefundCase) -> dict:
    return {
        "id": str(c.id),
        "contract_id": str(c.contract_id) if c.contract_id else None,
        "student_id": str(c.student_id) if c.student_id else None,
        "mzk_manager_id": str(c.mzk_manager_id),
        "mzk_manager_name": c.mzk_manager.name if getattr(c, "mzk_manager", None) else None,
        "amount": float(c.amount) if c.amount is not None else None,
        "applicant_name": c.applicant_name,
        "payer_name": c.payer_name,
        "reason": c.reason,
        "provided_services": c.provided_services or [],
        "outstanding_obligations": c.outstanding_obligations or [],
        "specialist_explanations": c.specialist_explanations,
        "correspondence": c.correspondence,
        "calculation": c.calculation,
        "level_criteria": c.level_criteria or {},
        "level": c.level.value if c.level else None,
        "bonus_amount": c.bonus_amount,
        "level_approved_by": str(c.level_approved_by) if c.level_approved_by else None,
        "level_approved_at": c.level_approved_at.isoformat() if c.level_approved_at else None,
        "status": c.status.value,
        "opened_at": c.opened_at.isoformat(),
        "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
        "resolution_summary": c.resolution_summary,
        "decision": c.decision,
        "approval_note": c.approval_note,
        "approved_by": str(c.approved_by) if c.approved_by else None,
        "approved_at": c.approved_at.isoformat() if c.approved_at else None,
        "execution_confirmation": c.execution_confirmation,
        "bonus_paid_at": c.bonus_paid_at.isoformat() if c.bonus_paid_at else None,
    }


@router.get("")
async def list_refund_cases(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    status: str | None = None,
):
    require_access(current_user, "refund_cases", Action.manage)
    query = select(RefundCase).options(selectinload(RefundCase.mzk_manager)).order_by(RefundCase.opened_at.desc())
    if status:
        try:
            query = query.where(RefundCase.status == RefundCaseStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")
    result = await db.execute(query)
    return {"items": [_to_dict(c) for c in result.scalars().all()]}


@router.post("")
async def create_refund_case(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "refund_cases", Action.manage)
    case = RefundCase(
        contract_id=optional_uuid(body, "contract_id"),
        student_id=optional_uuid(body, "student_id"),
        mzk_manager_id=optional_uuid(body, "mzk_manager_id") or current_user.id,
        amount=body.get("amount"),
        status=RefundCaseStatus.draft,
        opened_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        applicant_name=body.get("applicant_name"),
        payer_name=body.get("payer_name"),
        reason=(body.get("reason") or "").strip() or None,
        provided_services=body.get("provided_services") or [],
        outstanding_obligations=body.get("outstanding_obligations") or [],
        specialist_explanations=body.get("specialist_explanations"),
        correspondence=body.get("correspondence"),
        calculation=body.get("calculation"),
    )
    db.add(case)
    await db.commit()
    result = await db.execute(
        select(RefundCase).options(selectinload(RefundCase.mzk_manager)).where(RefundCase.id == case.id)
    )
    return _to_dict(result.scalar_one())


@router.patch("/{case_id}/bonus-paid")
async def mark_refund_bonus_paid(
    case_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "refund_cases", Action.manage)
    require_access(current_user, "refund_approval", Action.manage)
    case = await db.get(RefundCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Кейс не найден")
    if case.bonus_paid_at:
        raise HTTPException(status_code=409, detail="Бонус по этому кейсу уже отмечен как выплаченный")
    if case.status != RefundCaseStatus.closed or not case.execution_confirmation:
        raise HTTPException(status_code=409, detail="Бонус доступен только после полного исполнения возврата")
    if not case.approved_at or not case.level or case.bonus_amount is None:
        raise HTTPException(status_code=409, detail="Кейс не прошёл обязательное утверждение")
    case.bonus_paid_at = datetime.now(timezone.utc)
    await log_change(
        db,
        "refund_case",
        case.id,
        "bonus_paid",
        None,
        str(case.bonus_amount),
        str(current_user.id),
        source="refund_cases_api",
    )
    await db.commit()
    result = await db.execute(select(RefundCase).options(selectinload(RefundCase.mzk_manager)).where(RefundCase.id == case.id))
    return _to_dict(result.scalar_one())


@router.patch("/{case_id}/level")
async def set_refund_case_level(
    case_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Утверждение уровня сложности уполномоченным лицом (п.6.8). МЗК не вправе
    самостоятельно повышать уровень после решения кейса (п.6.9) — проверяем это здесь."""
    require_access(current_user, "refund_cases", Action.manage)
    result = await db.execute(select(RefundCase).where(RefundCase.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Кейс не найден")
    if case.status == RefundCaseStatus.resolved and current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Изменение уровня решённого кейса требует согласования администратора")
    if case.level_approved_at:
        _require_approved_change_basis(body)

    try:
        criteria = body.get("criteria") or {}
        if not isinstance(criteria, dict):
            raise ValueError
        # Multiple signs resolve to the highest severity, never a manually
        # selected lower level.
        requested = RefundLevel(body["level"])
        levels = [requested]
        if criteria.get("court_threat") or criteria.get("disputed_scope"):
            levels.append(RefundLevel.red)
        elif criteria.get("multiple_services") or criteria.get("written_claim"):
            levels.append(RefundLevel.orange)
        case.level = max(levels, key=lambda level: (RefundLevel.yellow, RefundLevel.orange, RefundLevel.red).index(level))
        case.level_criteria = criteria
    except (KeyError, ValueError):
        raise HTTPException(status_code=422, detail="Неверный уровень")
    # Сумму замораживаем вместе с утверждением уровня: раньше она считалась на
    # лету при сериализации, и правка ставки переписывала выплаты по всем уже
    # закрытым кейсам.
    refund_rules = await active_rules(db, RewardRuleKind.refund_case_bonus)
    case.bonus_amount = refund_amount_from_payload(
        refund_rules.get(case.level.value), case.level.value
    )
    case.level_approved_by = current_user.id
    case.level_approved_at = datetime.now(timezone.utc)
    await db.commit()
    result = await db.execute(
        select(RefundCase).options(selectinload(RefundCase.mzk_manager)).where(RefundCase.id == case.id)
    )
    return _to_dict(result.scalar_one())


@router.patch("/{case_id}/resolve")
async def resolve_refund_case(
    case_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "refund_cases", Action.manage)
    result = await db.execute(select(RefundCase).where(RefundCase.id == case_id))
    case = result.scalar_one_or_none()
    if not case:
        raise HTTPException(status_code=404, detail="Кейс не найден")
    if not case.level:
        raise HTTPException(status_code=422, detail="Сначала утвердите уровень сложности кейса")
    if not case.approved_at:
        raise HTTPException(status_code=422, detail="Сначала утвердите решение уполномоченным лицом")
    if not (body.get("decision") or case.decision):
        raise HTTPException(status_code=422, detail="Решение обязательно")
    if not (body.get("execution_confirmation") or case.execution_confirmation):
        raise HTTPException(status_code=422, detail="Нужно подтверждение исполнения")

    requested_decision = (body.get("decision") or case.decision or "").strip()
    if case.approved_at and requested_decision != (case.decision or ""):
        _require_approved_change_basis(body)

    case.status = RefundCaseStatus.closed
    case.resolved_at = datetime.now(timezone.utc)
    case.resolution_summary = body.get("resolution_summary")
    case.decision = requested_decision
    case.execution_confirmation = body.get("execution_confirmation") or case.execution_confirmation
    await db.commit()
    result = await db.execute(
        select(RefundCase).options(selectinload(RefundCase.mzk_manager)).where(RefundCase.id == case.id)
    )
    return _to_dict(result.scalar_one())


@router.patch("/{case_id}/approve")
async def approve_refund_case(case_id: uuid.UUID, body: dict, db: Annotated[AsyncSession, Depends(get_db)], current_user: CurrentUser):
    require_access(current_user, "refund_cases", Action.manage)
    case = await db.get(RefundCase, case_id)
    if not case:
        raise HTTPException(status_code=404, detail="Кейс не найден")
    require_access(current_user, "refund_approval", Action.manage)
    decision = (body.get("decision") or "").strip()
    approval_note = (body.get("approval_note") or "").strip()
    if not decision or not approval_note:
        raise HTTPException(status_code=422, detail="Нужны решение и письменное согласование")
    if case.approved_at and (decision != (case.decision or "") or approval_note != (case.approval_note or "")):
        reason, written_approval = _require_approved_change_basis(body)
        await log_change(
            db, "refund_case", case.id, "approved_decision_amended",
            case.decision, decision, str(current_user.id), reason,
        )
        approval_note = f"{approval_note}\nОснование изменения: {written_approval}"
    case.decision = decision
    case.approval_note = approval_note
    case.approved_by = current_user.id
    case.approved_at = datetime.now(timezone.utc)
    case.status = RefundCaseStatus.awaiting_execution
    await db.commit()
    result = await db.execute(select(RefundCase).options(selectinload(RefundCase.mzk_manager)).where(RefundCase.id == case.id))
    return _to_dict(result.scalar_one())
