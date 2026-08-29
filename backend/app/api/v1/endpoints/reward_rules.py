"""Конструктор вознаграждений: чтение и правка ставок.

Читать может весь персонал — экраны вознаграждений показывают ставки в
подписях, и ментору они нужны не меньше, чем админу. Править может только
админ: это деньги и регламент.

Правка не меняет строку, а закрывает действующую и добавляет следующую версию
(supersede_rule), поэтому история ставок восстановима, а начисленные суммы
остаются нетронутыми — они хранят применённую ставку у себя.
"""
from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import AdminOnly, CurrentUser
from app.core.permissions import Action, require_access
from app.models.reward_rule import RewardRule, RewardRuleKind
from app.models.user import UserRole
from app.schemas.reward_rule import RewardRuleOut, RewardRulesResponse, RewardRuleUpdate
from app.services.reward_rules import active_rules, supersede_rule

router = APIRouter(prefix="/reward-rules", tags=["reward_rules"])

@router.get("", response_model=RewardRulesResponse)
async def list_reward_rules(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "reward_rules", Action.view)

    grouped = {kind.value: await active_rules(db, kind) for kind in RewardRuleKind}
    stage = grouped.get(RewardRuleKind.mentor_stage_pct.value, {})
    stage_sum = sum(int(payload.get("pct", 0) or 0) for payload in stage.values())

    return RewardRulesResponse(**grouped, stage_pct_sum=stage_sum)


@router.put("/{kind}/{rule_key}", response_model=RewardRuleOut, dependencies=[AdminOnly])
async def update_reward_rule(
    kind: RewardRuleKind,
    rule_key: str,
    body: RewardRuleUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    payload = body.payload
    if payload.kind != kind.value:
        raise HTTPException(status_code=422, detail="Вид ставки в payload не совпадает с путём")

    current = (
        await db.execute(
            select(RewardRule).where(
                RewardRule.kind == kind,
                RewardRule.rule_key == rule_key,
                RewardRule.superseded_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current is None:
        raise HTTPException(status_code=404, detail="Ставка не найдена")

    # kind — часть адреса, внутри строки он избыточен и только дублировал бы
    # дискриминатор в данных.
    stored = payload.model_dump(exclude={"kind"})
    old_payload = dict(current.payload or {})

    fresh = await supersede_rule(db, kind, rule_key, stored, current_user.id, body.note)
    await db.flush()
    await log_change(
        db,
        "reward_rule",
        fresh.id,
        f"{kind.value}.{rule_key}",
        json.dumps(old_payload, ensure_ascii=False),
        json.dumps(stored, ensure_ascii=False),
        str(current_user.id),
        source="reward_rules_constructor",
    )
    await db.commit()
    await db.refresh(fresh)
    return fresh


@router.get("/{kind}/{rule_key}/history", response_model=list[RewardRuleOut], dependencies=[AdminOnly])
async def rule_history(
    kind: RewardRuleKind,
    rule_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    rows = await db.execute(
        select(RewardRule)
        .where(RewardRule.kind == kind, RewardRule.rule_key == rule_key)
        .order_by(RewardRule.version.desc())
    )
    return list(rows.scalars().all())
