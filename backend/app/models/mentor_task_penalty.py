"""Реестр финансовых санкций ментора по цветовым статусам (регламент менторов, раздел 6).

Суммы фиксированы регламентом п.6.2: жёлтый 2500₸, оранжевый 5000₸, красный 7500₸.
Реестр без реальных денежных операций — фиксация факта нарушения для учёта.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.reward_defaults import DEFAULT_TASK_PENALTY


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PenaltyColor(str, enum.Enum):
    yellow = "yellow"
    orange = "orange"
    red = "red"

    @property
    def amount(self) -> int:
        """Ставка по умолчанию — см. комментарий у MentorStageKind.stage_pct."""
        return DEFAULT_TASK_PENALTY[self.value]


class MentorTaskPenalty(Base):
    __tablename__ = "mentor_task_penalties"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    mentor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("student_tasks.id", ondelete="SET NULL"), nullable=True)
    color: Mapped[PenaltyColor] = mapped_column(SAEnum(PenaltyColor, name="penalty_color"))
    # Сумма на момент фиксации: раньше считалась на лету при сериализации, и
    # правка ставки задним числом меняла все прошлые санкции.
    amount: Mapped[int] = mapped_column(Integer, default=0)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    contested: Mapped[bool] = mapped_column(Boolean, default=False)
    contest_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    mentor: Mapped["User"] = relationship(foreign_keys=[mentor_id])
