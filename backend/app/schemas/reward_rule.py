"""Схемы конструктора вознаграждений.

Значение ставки лежит в JSONB, поэтому вся защита от мусора стоит здесь:
дискриминированный union по `kind` не пропустит ни процент 300, ни пустой
список порогов, ни отрицательную сумму. Без него JSONB быстро превратился бы
в свалку — валидировать его в резолверах было бы поздно, строка уже в базе.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

_cfg = ConfigDict(from_attributes=True)

# Потолок на суммы: защита от опечатки в лишний ноль, а не бизнес-ограничение.
_MAX_AMOUNT = 10_000_000


class StagePctPayload(BaseModel):
    kind: Literal["mentor_stage_pct"]
    pct: int = Field(ge=0, le=100)


class TaskPenaltyPayload(BaseModel):
    kind: Literal["mentor_task_penalty"]
    amount: int = Field(ge=0, le=_MAX_AMOUNT)


class RefundBonusPayload(BaseModel):
    kind: Literal["refund_case_bonus"]
    amount: int = Field(ge=0, le=_MAX_AMOUNT)


class MzkTier(BaseModel):
    min_score_pct: float = Field(ge=0, le=100)
    amount: int = Field(ge=0, le=_MAX_AMOUNT)


class MzkTiersPayload(BaseModel):
    kind: Literal["mzk_quality_bonus"]
    tiers: list[MzkTier] = Field(min_length=1, max_length=10)

    @model_validator(mode="after")
    def _thresholds_must_be_distinct(self) -> "MzkTiersPayload":
        """Пороги не должны повторяться.

        Резолвер сортирует тиры сам, поэтому порядок ввода значения не имеет,
        а вот два одинаковых порога — это неоднозначность: какая из двух сумм
        сработает, зависело бы от порядка строк.
        """
        thresholds = [tier.min_score_pct for tier in self.tiers]
        if len(set(thresholds)) != len(thresholds):
            raise ValueError("Пороги бонуса не должны повторяться")
        return self


RewardRulePayload = Annotated[
    Union[StagePctPayload, TaskPenaltyPayload, RefundBonusPayload, MzkTiersPayload],
    Field(discriminator="kind"),
]


class RewardRuleUpdate(BaseModel):
    payload: RewardRulePayload
    note: str | None = Field(default=None, max_length=500)


class RewardRuleOut(BaseModel):
    model_config = _cfg

    id: uuid.UUID
    kind: str
    rule_key: str
    payload: dict
    version: int
    effective_from: datetime
    superseded_at: datetime | None = None
    note: str | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime


class RewardRulesResponse(BaseModel):
    """Действующие ставки, сгруппированные по виду, — весь конструктор одним GET."""

    mentor_stage_pct: dict[str, dict] = {}
    mentor_task_penalty: dict[str, dict] = {}
    mzk_quality_bonus: dict[str, dict] = {}
    refund_case_bonus: dict[str, dict] = {}
    # Сумма долей этапов. Не блокируем расхождение со 100% (бизнес вправе
    # задать иначе), но показываем, чтобы опечатку было видно сразу.
    stage_pct_sum: int = 0
