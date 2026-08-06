"""Вознаграждение ментора по этапам — ПИЛОТНАЯ версия (регламент менторов, разделы 6-8).

Только расчёт/отображение — НЕ связано с реальной выплатой денег или
бухгалтерией. Проценты по этапам фиксированы регламентом п.7.1: Pre-Admission
30%, Admission 40%, Post-Admission 30%. Приёмка этапа — вручную уполномоченным
сотрудником, не автоматически из завершения задач роадмапа.

Штрафы по цветам (раздел 6) — реестр без реальных денежных операций, суммы
фиксированы регламентом п.6.2.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.mentor_stage_reward import MentorStageReward, MentorStageKind
from app.models.mentor_task_penalty import MentorTaskPenalty, PenaltyColor
from app.models.user import UserRole
from app.models.reward_rule import RewardRuleKind
from app.models.roadmap import Roadmap, Stage, RoadmapItemStatus, TaskPriority
from app.services.reward_rules import active_rules, penalty_amount_from_payload, stage_pct_from_payload

router = APIRouter(tags=["mentor_rewards"])


def _require_staff(user):
    if user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")


def resolve_mentor_scope(*, viewer_role, viewer_id, requested_mentor_id: str | None):
    """Какой mentor_id ставить в фильтр списка (None = все менторы).

    Раньше здесь была цепочка `if mentor_id: ... elif role == mentor: ...
    else: _require_staff(...)`, в которой проверка прав стояла только в
    последней ветке. Любой авторизованный — включая студента — получал чужие
    суммы вознаграждений и историю штрафов, просто передав ?mentor_id=<чужой>.

    Возвращает UUID для фильтра либо None; бросает 403.
    """
    if viewer_role in (UserRole.admin, UserRole.mzk_manager):
        return _parse_mentor_id(requested_mentor_id)

    if viewer_role == UserRole.mentor:
        # Ментор видит только себя. Явный ?mentor_id=<свой> допускаем — это
        # тот же результат, — а любой чужой отклоняем.
        if requested_mentor_id is not None:
            requested = _parse_mentor_id(requested_mentor_id)
            if requested != viewer_id:
                raise HTTPException(status_code=403, detail="Access denied")
        return viewer_id

    raise HTTPException(status_code=403, detail="Access denied")


def can_contest_penalty(*, viewer_role, viewer_id, penalty_mentor_id) -> bool:
    """Возражать может сам оштрафованный ментор либо персонал (от его имени).

    Прежняя проверка отсекала только «ментора с чужим штрафом», поэтому любая
    другая роль — включая студента — проходила её насквозь.
    """
    if viewer_role in (UserRole.admin, UserRole.mzk_manager):
        return True
    if viewer_role == UserRole.mentor:
        return penalty_mentor_id == viewer_id
    return False


def _parse_mentor_id(raw: str | None):
    if raw is None:
        return None
    try:
        return uuid.UUID(raw)
    except (ValueError, AttributeError, TypeError):
        # Раньше кривой UUID падал наружу как 500.
        raise HTTPException(status_code=422, detail="Неверный mentor_id")


def _business_days_after(start: datetime, days: int) -> datetime:
    current = start
    remaining = days
    while remaining:
        current = current.replace(hour=0, minute=0, second=0, microsecond=0)
        current = current + timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def _reward_to_dict(r: MentorStageReward) -> dict:
    return {
        "id": str(r.id),
        "student_id": str(r.student_id),
        "mentor_id": str(r.mentor_id),
        "mentor_name": r.mentor.name if getattr(r, "mentor", None) else None,
        "stage": r.stage.value,
        # Ставка из строки, а не из enum: после правки в конструкторе карточка
        # обязана показывать процент, по которому реально посчитали сумму.
        "stage_pct": r.stage_pct_applied,
        "total_contract_amount": float(r.total_contract_amount),
        "computed_amount": float(r.computed_amount),
        "accepted": r.accepted,
        "accepted_by": str(r.accepted_by) if r.accepted_by else None,
        "accepted_at": r.accepted_at.isoformat() if r.accepted_at else None,
        "created_at": r.created_at.isoformat(),
    }


def _penalty_to_dict(p: MentorTaskPenalty) -> dict:
    return {
        "id": str(p.id),
        "mentor_id": str(p.mentor_id),
        "mentor_name": p.mentor.name if getattr(p, "mentor", None) else None,
        "task_id": str(p.task_id) if p.task_id else None,
        "color": p.color.value,
        # Заморожено при фиксации — правка ставки не переписывает прошлые санкции.
        "amount": p.amount,
        "recorded_at": p.recorded_at.isoformat(),
        "recorded_by": str(p.recorded_by) if p.recorded_by else None,
        "contested": p.contested,
        "contest_note": p.contest_note,
    }


@router.get("/mentor-stage-rewards")
async def list_stage_rewards(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    mentor_id: str | None = None,
    student_id: str | None = None,
):
    """Расчёт вознаграждения по этапам (ПИЛОТ) — не боевые выплаты."""
    query = select(MentorStageReward).options(selectinload(MentorStageReward.mentor))
    scoped_mentor_id = resolve_mentor_scope(
        viewer_role=current_user.role,
        viewer_id=current_user.id,
        requested_mentor_id=mentor_id,
    )
    if scoped_mentor_id is not None:
        query = query.where(MentorStageReward.mentor_id == scoped_mentor_id)
    if student_id:
        try:
            student_uuid = uuid.UUID(student_id)
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(status_code=422, detail="Неверный student_id")
        query = query.where(MentorStageReward.student_id == student_uuid)
    result = await db.execute(query.order_by(MentorStageReward.created_at.desc()))
    return {"items": [_reward_to_dict(r) for r in result.scalars().all()], "pilot": True}


@router.post("/mentor-stage-rewards")
async def create_stage_reward(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_staff(current_user)
    try:
        stage = MentorStageKind(body["stage"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=422, detail="Неверный этап")

    # Сырой body: нечисловая сумма раньше падала как 500, отрицательная
    # проходила и давала отрицательное начисление.
    try:
        total = float(body["total_contract_amount"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=422, detail="Неверная сумма договора")
    if total <= 0:
        raise HTTPException(status_code=422, detail="Сумма договора должна быть больше нуля")

    try:
        student_uuid = uuid.UUID(body["student_id"])
        mentor_uuid = uuid.UUID(body["mentor_id"])
    except (KeyError, ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail="Неверный student_id или mentor_id")

    # Действующая ставка из конструктора; её же и замораживаем в строке.
    rules = await active_rules(db, RewardRuleKind.mentor_stage_pct)
    pct = stage_pct_from_payload(rules.get(stage.value), stage.value)

    reward = MentorStageReward(
        student_id=student_uuid,
        mentor_id=mentor_uuid,
        stage=stage,
        total_contract_amount=total,
        computed_amount=total * pct / 100,
        stage_pct_applied=pct,
        created_at=datetime.now(timezone.utc),
    )
    db.add(reward)
    await db.commit()
    result = await db.execute(
        select(MentorStageReward).options(selectinload(MentorStageReward.mentor)).where(MentorStageReward.id == reward.id)
    )
    return _reward_to_dict(result.scalar_one())


@router.patch("/mentor-stage-rewards/{reward_id}/accept")
async def accept_stage_reward(
    reward_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Приёмка этапа уполномоченным сотрудником (п.7.2) — только вручную."""
    _require_staff(current_user)
    result = await db.execute(select(MentorStageReward).where(MentorStageReward.id == reward_id))
    reward = result.scalar_one_or_none()
    if not reward:
        raise HTTPException(status_code=404, detail="Этап не найден")
    roadmap_result = await db.execute(
        select(Roadmap).options(selectinload(Roadmap.stages)).where(Roadmap.student_id == reward.student_id)
    )
    roadmaps = roadmap_result.scalars().all()
    stage_aliases = {
        MentorStageKind.pre_admission: ("pre-admission", "pre_admission", "pre admission"),
        MentorStageKind.admission: ("admission",),
        MentorStageKind.post_admission: ("post-admission", "post_admission", "post admission"),
    }[reward.stage]
    matched_stage = next(
        (
            stage
            for roadmap in roadmaps
            for stage in roadmap.stages
            if any(alias in stage.name.lower() for alias in stage_aliases)
        ),
        None,
    )
    if matched_stage and not matched_stage.can_complete:
        raise HTTPException(
            status_code=409,
            detail="Этапную выплату нельзя принять до завершения обязательных задач",
            headers={"X-Error-Code": "MENTOR_REWARD_STAGE_INCOMPLETE"},
        )
    reward.accepted = True
    reward.accepted_by = current_user.id
    reward.accepted_at = datetime.now(timezone.utc)
    await db.commit()
    result = await db.execute(
        select(MentorStageReward).options(selectinload(MentorStageReward.mentor)).where(MentorStageReward.id == reward.id)
    )
    return _reward_to_dict(result.scalar_one())


@router.get("/mentor-task-penalties")
async def list_task_penalties(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    mentor_id: str | None = None,
):
    query = select(MentorTaskPenalty).options(selectinload(MentorTaskPenalty.mentor))
    scoped_mentor_id = resolve_mentor_scope(
        viewer_role=current_user.role,
        viewer_id=current_user.id,
        requested_mentor_id=mentor_id,
    )
    if scoped_mentor_id is not None:
        query = query.where(MentorTaskPenalty.mentor_id == scoped_mentor_id)
    result = await db.execute(query.order_by(MentorTaskPenalty.recorded_at.desc()))
    return {"items": [_penalty_to_dict(p) for p in result.scalars().all()]}


@router.post("/mentor-task-penalties")
async def create_task_penalty(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Фиксация нарушения — вручную уполномоченным сотрудником (п.6.7-6.9)."""
    _require_staff(current_user)
    try:
        color = PenaltyColor(body["color"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=422, detail="Неверный цвет")

    try:
        mentor_uuid = uuid.UUID(body["mentor_id"])
    except (KeyError, ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=422, detail="Неверный mentor_id")

    penalty_rules = await active_rules(db, RewardRuleKind.mentor_task_penalty)
    amount = penalty_amount_from_payload(penalty_rules.get(color.value), color.value)

    penalty = MentorTaskPenalty(
        mentor_id=mentor_uuid,
        task_id=uuid.UUID(body["task_id"]) if body.get("task_id") else None,
        color=color,
        amount=amount,
        recorded_at=datetime.now(timezone.utc),
        recorded_by=current_user.id,
    )
    db.add(penalty)
    await db.commit()
    result = await db.execute(
        select(MentorTaskPenalty).options(selectinload(MentorTaskPenalty.mentor)).where(MentorTaskPenalty.id == penalty.id)
    )
    return _penalty_to_dict(result.scalar_one())


@router.patch("/mentor-task-penalties/{penalty_id}/contest")
async def contest_task_penalty(
    penalty_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Право ментора на возражение в течение 2 рабочих дней (п.6.8)."""
    result = await db.execute(select(MentorTaskPenalty).where(MentorTaskPenalty.id == penalty_id))
    penalty = result.scalar_one_or_none()
    if not penalty:
        raise HTTPException(status_code=404, detail="Санкция не найдена")
    if not can_contest_penalty(
        viewer_role=current_user.role,
        viewer_id=current_user.id,
        penalty_mentor_id=penalty.mentor_id,
    ):
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == UserRole.mentor:
        deadline = _business_days_after(penalty.recorded_at, 2)
        if datetime.now(timezone.utc) > deadline:
            raise HTTPException(status_code=409, detail="Срок возражения истёк")
    penalty.contested = True
    penalty.contest_note = body.get("note")
    await db.commit()
    result = await db.execute(
        select(MentorTaskPenalty).options(selectinload(MentorTaskPenalty.mentor)).where(MentorTaskPenalty.id == penalty.id)
    )
    return _penalty_to_dict(result.scalar_one())
