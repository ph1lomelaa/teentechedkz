"""Вознаграждение ментора по этапам — ПИЛОТНАЯ версия (регламент менторов, разделы 6-8).

Только расчёт/отображение, не связано с реальной выплатой денег или бухгалтерией.
Проценты по этапам фиксированы регламентом п.7.1: Pre-Admission 30%,
Admission 40%, Post-Admission 30%.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.reward_defaults import DEFAULT_STAGE_PCT


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MentorStageKind(str, enum.Enum):
    pre_admission = "pre_admission"
    admission = "admission"
    post_admission = "post_admission"

    @property
    def stage_pct(self) -> int:
        """Ставка по умолчанию. Действующая живёт в reward_rules (конструктор
        админа); здесь — подстраховка на случай отсутствия строки правила."""
        return DEFAULT_STAGE_PCT[self.value]


class MentorStageReward(Base):
    __tablename__ = "mentor_stage_rewards"
    __table_args__ = (UniqueConstraint("student_id", "mentor_id", "stage"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mentor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    stage: Mapped[MentorStageKind] = mapped_column(SAEnum(MentorStageKind, name="mentor_stage_kind"))
    # Введена вручную админом — сумма за полный цикл сопровождения одного студента.
    total_contract_amount: Mapped[float] = mapped_column(Numeric(14, 2))
    computed_amount: Mapped[float] = mapped_column(Numeric(14, 2))
    # Ставка, по которой посчитали. Замораживается при начислении: смена
    # процента в конструкторе не должна переписывать историю, а карточка
    # обязана показывать процент, соответствующий сохранённой сумме.
    stage_pct_applied: Mapped[int] = mapped_column(Integer, default=0)
    accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    mentor: Mapped["User"] = relationship(foreign_keys=[mentor_id])
