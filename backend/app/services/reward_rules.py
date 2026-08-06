"""Разбор ставок вознаграждений: payload из БД -> число для расчёта.

Единственное место, которому разрешено заглядывать внутрь `RewardRule.payload`.
Всё остальное работает с числами, поэтому смена формы payload не расходится по
эндпоинтам.

Резолверы чистые и на каждый битый вход отвечают значением из регламента
(app/core/reward_defaults.py), а не исключением: отсутствие строки правила —
штатная ситуация (неполный раскат, новая ставка ещё не заведена), и деградация
до сегодняшнего поведения безопаснее падения расчёта.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.reward_defaults import (
    DEFAULT_MZK_BONUS_TIERS,
    DEFAULT_REFUND_BONUS,
    DEFAULT_STAGE_PCT,
    DEFAULT_TASK_PENALTY,
)
from app.models.reward_rule import RewardRule, RewardRuleKind


def _int_or_none(value: object) -> int | None:
    """int из payload. bool отсекаем: True прошёл бы как 1 и молча стал ставкой."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def stage_pct_from_payload(payload: dict | None, stage_value: str) -> int:
    """Процент этапа. Ставка 0 — легитимна, поэтому проверяем на None, не на falsy."""
    if isinstance(payload, dict):
        pct = _int_or_none(payload.get("pct"))
        if pct is not None and 0 <= pct <= 100:
            return pct
    return DEFAULT_STAGE_PCT.get(stage_value, 0)


def penalty_amount_from_payload(payload: dict | None, color_value: str) -> int:
    if isinstance(payload, dict):
        amount = _int_or_none(payload.get("amount"))
        if amount is not None and amount >= 0:
            return amount
    return DEFAULT_TASK_PENALTY.get(color_value, 0)


def refund_amount_from_payload(payload: dict | None, level_value: str) -> int:
    if isinstance(payload, dict):
        amount = _int_or_none(payload.get("amount"))
        if amount is not None and amount >= 0:
            return amount
    return DEFAULT_REFUND_BONUS.get(level_value, 0)


def bonus_from_tiers(tiers: list | None, score_pct: float, disqualified: bool) -> int:
    """Бонус ОКК по порогам. Повторяет семантику прежней bonus_for_score.

    Пороги сортируем по убыванию сами: если админ введёт их в обратном порядке,
    нижний иначе перекрыл бы верхний и молча выключил премию.
    """
    if disqualified:
        return 0

    usable: list[tuple[float, int]] = []
    for tier in tiers or []:
        if not isinstance(tier, dict):
            continue
        threshold = tier.get("min_score_pct")
        amount = _int_or_none(tier.get("amount"))
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            continue
        if amount is None or amount < 0:
            continue
        usable.append((float(threshold), amount))

    if not usable:
        usable = [
            (float(t["min_score_pct"]), int(t["amount"])) for t in DEFAULT_MZK_BONUS_TIERS
        ]

    for threshold, amount in sorted(usable, key=lambda t: t[0], reverse=True):
        if score_pct >= threshold:
            return amount
    return 0


async def active_rules(db: AsyncSession, kind: RewardRuleKind) -> dict[str, dict]:
    """Действующие ставки вида: {rule_key: payload}.

    Правил около десятка, поэтому кэш не заводим — один индексированный SELECT
    дешевле, чем баг с инвалидацией.
    """
    rows = await db.execute(
        select(RewardRule.rule_key, RewardRule.payload).where(
            RewardRule.kind == kind,
            RewardRule.superseded_at.is_(None),
        )
    )
    return {key: payload or {} for key, payload in rows.all()}


async def rules_as_of(db: AsyncSession, kind: RewardRuleKind, at: datetime) -> dict[str, dict]:
    """Ставки, действовавшие в момент `at` — для разбора исторических начислений."""
    rows = await db.execute(
        select(RewardRule.rule_key, RewardRule.payload).where(
            RewardRule.kind == kind,
            RewardRule.effective_from <= at,
            (RewardRule.superseded_at.is_(None)) | (RewardRule.superseded_at > at),
        )
    )
    return {key: payload or {} for key, payload in rows.all()}


async def supersede_rule(
    db: AsyncSession,
    kind: RewardRuleKind,
    rule_key: str,
    payload: dict,
    user_id: uuid.UUID | None,
    note: str | None = None,
) -> RewardRule:
    """Заменить действующую ставку новой версией.

    Старую строку не правим: помечаем `superseded_at` и добавляем следующую
    версию. Коммит — на вызывающей стороне.
    """
    current = (
        await db.execute(
            select(RewardRule).where(
                RewardRule.kind == kind,
                RewardRule.rule_key == rule_key,
                RewardRule.superseded_at.is_(None),
            )
        )
    ).scalar_one_or_none()

    # Одна отметка времени на обе строки: старая закрывается ровно тогда,
    # когда открывается новая, без зазора, в который не действует ни одна.
    now = datetime.now(timezone.utc)
    if current is not None:
        current.superseded_at = now

    fresh = RewardRule(
        kind=kind,
        rule_key=rule_key,
        payload=payload,
        version=(current.version + 1) if current else 1,
        effective_from=now,
        created_by=user_id,
        note=note,
    )
    db.add(fresh)
    return fresh
