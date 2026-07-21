import uuid
from datetime import datetime, date

from sqlalchemy import String, Text, Date, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Scholarship(Base):
    """Стипендии и образовательные программы из Notion."""

    __tablename__ = "scholarships"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    country_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("country_reference.id", ondelete="SET NULL"), nullable=True, index=True
    )

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    requirements: Mapped[str | None] = mapped_column(Text, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[str | None] = mapped_column(String(255), nullable=True)  # e.g., "$1000/month" or "Full coverage"

    # Notion sync metadata (read-only mirror)
    source_notion_page_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True, index=True
    )
    source_notion_last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    country: Mapped["CountryReference | None"] = relationship("CountryReference")
