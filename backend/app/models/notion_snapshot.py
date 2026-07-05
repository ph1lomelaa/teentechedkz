import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Float, Boolean, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NotionMatchStatus(str, enum.Enum):
    new = "new"          # не привязан — ждёт ручного решения
    linked = "linked"    # привязан к студенту (вручную или автоматом при точном матче)
    ignored = "ignored"


class NotionSnapshot(Base):
    """Строка Notion-базы «Весь пайплайн клиентов». Read-only зеркало:
    обновляется целиком при каждом синке, в CRM ничего не пишет —
    перенос значений в карточку только вручную через «Принять из Notion»."""

    __tablename__ = "notion_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    notion_page_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    notion_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    full_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone_normalized: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    raw_properties: Mapped[dict] = mapped_column(JSONB)    # {колонка Notion: значение}
    normalized_data: Mapped[dict] = mapped_column(JSONB)   # маппинг во внутренние ключи

    notion_last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    suggested_student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True
    )
    suggested_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[NotionMatchStatus] = mapped_column(
        SAEnum(NotionMatchStatus, name="notion_match_status"), default=NotionMatchStatus.new
    )
    linked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Привязку сняли вручную — автосинк не должен привязывать обратно
    manual_unlink: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student | None"] = relationship(foreign_keys=[student_id])
    suggested_student: Mapped["Student | None"] = relationship(foreign_keys=[suggested_student_id])
