"""Настраиваемые ставки вознаграждений — конструктор для админа.

Раньше все ставки были литералами в enum-свойствах моделей и дублировались
строками в UI: изменить процент этапа или сумму штрафа можно было только
правкой кода с последующим деплоем. Здесь они становятся данными.

Одна таблица с дискриминатором `kind` вместо четырёх: правил всего ~10 строк,
а формы у них разные — плоский процент, плоская сумма и список порогов. Явные
колонки под все три формы превратились бы в кашу из nullable-полей, поэтому
значение лежит в JSONB, а от «супа» его защищает дискриминированный union
Pydantic на границе API: `pct: 300` или пустой список порогов не пройдут
валидацию и в базу не попадут.

Версионирование append-only: правка не меняет строку, а помечает старую
`superseded_at` и вставляет новую с version+1. Частичный уникальный индекс
гарантирует ровно одну действующую ставку на слот, а история остаётся в самой
таблице — по ней восстанавливается ставка, действовавшая в любой момент.

Начисленные суммы при этом не пересчитываются: ставка, по которой посчитали,
хранится в самой строке начисления (stage_pct_applied / amount / bonus_amount).
Эта таблица — про то, как считать ВПРЕДЬ.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RewardRuleKind(str, enum.Enum):
    """Вид ставки. Определяет форму payload — см. резолверы в services/reward_rules.py."""

    # payload: {"pct": 30}
    mentor_stage_pct = "mentor_stage_pct"
    # payload: {"amount": 2500}
    mentor_task_penalty = "mentor_task_penalty"
    # payload: {"tiers": [{"min_score_pct": 90, "amount": 20000}, ...]}
    mzk_quality_bonus = "mzk_quality_bonus"
    # payload: {"amount": 10000}
    refund_case_bonus = "refund_case_bonus"


class RewardRule(Base):
    __tablename__ = "reward_rules"
    __table_args__ = (
        # Действующая ставка на слот ровно одна. Частичный индекс ловит гонку
        # двух параллельных правок на уровне базы, а не договорённостей в коде.
        Index(
            "uq_reward_rules_active",
            "kind",
            "rule_key",
            unique=True,
            postgresql_where=("superseded_at IS NULL"),
        ),
        Index("ix_reward_rules_kind_key_from", "kind", "rule_key", "effective_from"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    kind: Mapped[RewardRuleKind] = mapped_column(
        SAEnum(RewardRuleKind, name="reward_rule_kind"), index=True
    )
    # Слот внутри вида: pre_admission / yellow / "default" для единственного
    # набора порогов МЗК. Значения повторяют члены соответствующих enum'ов.
    rule_key: Mapped[str] = mapped_column(String(50))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # NULL — ставка действует сейчас.
    superseded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Зачем меняли — чтобы через полгода не гадать по одной цифре в истории.
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
