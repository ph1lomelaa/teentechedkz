"""Заявка на доступ: то, что человек заполнил на /join, и решение по ней.

Зачем отдельная таблица, а не колонки в `users`
-----------------------------------------------
Заявка живёт своей жизнью: у неё есть данные формы (телефон, город,
направление), подсказка матчинга и след решения — кто и когда одобрил. Ничего
из этого не является свойством аккаунта, и половина теряет смысл сразу после
одобрения. В `users` это были бы восемь nullable-колонок, пустых у всех, кто
заведён руками.

Почему `requested_role`, а не сразу `users.role`
------------------------------------------------
`role=student` без `students.user_id` ломает весь кабинет: `get_current_student`
(core/deps.py) резолвит студента как `students WHERE user_id = me` и отдаёт 404
на каждом экране портала. Поэтому ждущий аккаунт держит нейтральную роль, а
желаемая роль лежит здесь и проставляется ровно в момент привязки к карточке.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

#: Значения `status`. Обычные строки, а не Postgres enum: новый тип пришлось бы
#: заводить миграцией, а `CREATE TYPE` при повторном прогоне уже ломал нам 085.
STATUS_NEW = "new"
STATUS_AUTO_APPROVED = "auto_approved"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
ACCESS_REQUEST_STATUSES = (STATUS_NEW, STATUS_AUTO_APPROVED, STATUS_APPROVED, STATUS_REJECTED)


class AccessRequest(Base):
    __tablename__ = "access_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    #: Одна заявка на аккаунт: повторный /join тем же Google обновляет её, а не
    #: заводит вторую строку в очереди админа.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    requested_role: Mapped[str] = mapped_column(String(20))

    full_name: Mapped[str] = mapped_column(String(500))
    phone_raw: Mapped[str] = mapped_column(String(50))
    #: Всегда через normalize_phone. Сырой телефон лежит рядом в phone_raw —
    #: показать человеку то, что он ввёл, и нормализованный искать.
    phone_normalized: Mapped[str] = mapped_column(String(50), index=True)
    city: Mapped[str | None] = mapped_column(String(500), nullable=True)
    direction: Mapped[str | None] = mapped_column(Text, nullable=True)

    #: Подсказка матчинга — основание для кнопки «Привязать», а не решение.
    suggested_student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True
    )
    suggested_confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3), nullable=True)
    suggested_method: Mapped[str | None] = mapped_column(String(30), nullable=True)

    status: Mapped[str] = mapped_column(String(20), default=STATUS_NEW, index=True)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    suggested_student: Mapped["Student | None"] = relationship(foreign_keys=[suggested_student_id])
