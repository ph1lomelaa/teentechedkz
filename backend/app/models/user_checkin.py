"""Ежедневная отметка сотрудника «я на месте» (чекин в 10:00).

Касается менторов и МЗК: студенты не отмечаются. Одна строка на пару
(пользователь, дата) — уникальный индекс не даёт продублировать отметку и
делает фоновую простановку `missed` идемпотентной.

Статус считается один раз, в момент записи, и дальше не пересчитывается:
`on_time`/`late` зависят от окна, а окно — настраиваемое, и правка настройки
задним числом не должна переписывать историю посещаемости.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CheckinStatus(str, enum.Enum):
    on_time = "on_time"
    late = "late"
    missed = "missed"


class UserCheckin(Base):
    __tablename__ = "user_checkins"
    __table_args__ = (
        UniqueConstraint("user_id", "checkin_date", name="uq_user_checkin_per_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Дата в таймзоне компании, не UTC: рабочий день сотрудника в Астане не
    # должен разъезжаться с датой из-за смещения сервера.
    checkin_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[CheckinStatus] = mapped_column(SAEnum(CheckinStatus, name="checkin_status"))
    # None у пропусков: проставлены фоном, человек не нажимал кнопку.
    checked_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
