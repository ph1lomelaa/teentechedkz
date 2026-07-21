import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class University(Base):
    __tablename__ = "universities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    country_ref_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("country_reference.id", ondelete="SET NULL"), nullable=True
    )
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    name: Mapped[str] = mapped_column(String(400), index=True)
    city: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    world_ranking: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tuition_range: Mapped[str] = mapped_column(String(200), default="")
    has_grants: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
