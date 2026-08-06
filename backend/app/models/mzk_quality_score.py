"""Ежемесячная ОКК МЗК — агрегат по MzkReview (регламент МЗК, раздел 7).

Бонусные пороги фиксированы регламентом (п.7.5): >=90% -> 20000₸,
80-89.99% -> 10000₸, <80% -> без бонуса.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.reward_defaults import DEFAULT_MZK_BONUS_TIERS


def _now() -> datetime:
    return datetime.now(timezone.utc)


def bonus_for_score(score_pct: float, disqualified: bool) -> int:
    """Бонус по умолчанию. Действующие пороги настраиваются в reward_rules —
    расчёт идёт через bonus_from_tiers, сюда попадаем только как в fallback."""
    if disqualified:
        return 0
    for tier in DEFAULT_MZK_BONUS_TIERS:
        if score_pct >= tier["min_score_pct"]:
            return int(tier["amount"])
    return 0


class MzkQualityScore(Base):
    __tablename__ = "mzk_quality_scores"
    __table_args__ = (UniqueConstraint("mzk_manager_id", "period_year", "period_month"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mzk_manager_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    period_year: Mapped[int] = mapped_column(Integer)
    period_month: Mapped[int] = mapped_column(Integer)
    valid_reviews_count: Mapped[int] = mapped_column(Integer, default=0)
    positive_reviews_count: Mapped[int] = mapped_column(Integer, default=0)
    score_pct: Mapped[float] = mapped_column(Numeric(5, 2), default=0)
    bonus_amount: Mapped[int] = mapped_column(Integer, default=0)
    disqualified: Mapped[bool] = mapped_column(Boolean, default=False)
    disqualified_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    objection_text: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    objection_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    mzk_manager: Mapped["User"] = relationship(foreign_keys=[mzk_manager_id])
