"""Переопределение состава ролей у правила реестра — то, что меняет админ.

Реестр в коде (`app/core/permissions.py`) остаётся дефолтом и списком
допустимого: строка здесь может изменить только набор ролей у уже описанного
правила. Пары, которой нет в коде, из базы не появится — иначе переименование
ресурса оставляло бы висеть правило-призрак, которого никто не проверяет.

Запертые правила (`Rule.locked`) сюда не попадают: сняв право админа на
управление правами, вернуть его было бы уже нечем.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PermissionOverride(Base):
    __tablename__ = "permission_overrides"
    __table_args__ = (
        UniqueConstraint("resource", "action", name="uq_permission_override_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    resource: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(20))
    #: Список ролей строками. Пустой список — законное значение: «никому».
    roles: Mapped[list] = mapped_column(JSONB)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
