"""Единичная оценка МЗК за отчётный период (регламент МЗК, раздел 7)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MzkReview(Base):
    __tablename__ = "mzk_reviews"
    __table_args__ = (UniqueConstraint("mzk_manager_id", "period_year", "period_month", "source_key", name="uq_mzk_reviews_source_period"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mzk_manager_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    period_year: Mapped[int] = mapped_column(Integer)
    period_month: Mapped[int] = mapped_column(Integer)
    is_positive: Mapped[bool] = mapped_column(Boolean)
    # п.7.8 — недействительные оценки (повтор одного лица, самооценка, давление и т.п.)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=True)
    invalidated_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    source_key: Mapped[str] = mapped_column(String(255), default="manual")
    source_kind: Mapped[str] = mapped_column(String(50), default="manual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    mzk_manager: Mapped["User"] = relationship(foreign_keys=[mzk_manager_id])
