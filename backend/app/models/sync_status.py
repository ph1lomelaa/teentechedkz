import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
import enum


class SyncSource(str, enum.Enum):
    notion = "notion"
    excel_portfolio = "excel_portfolio"
    excel_mzk = "excel_mzk"
    excel_cases = "excel_cases"
    excel_package = "excel_package"
    telegram = "telegram"
    whatsapp = "whatsapp"
    zoom = "zoom"


class SyncStatusEnum(str, enum.Enum):
    ok = "ok"
    stale = "stale"
    error = "error"
    archived_snapshot = "archived_snapshot"


class SyncStatus(Base):
    __tablename__ = "sync_status"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source: Mapped[SyncSource] = mapped_column(SAEnum(SyncSource, name="sync_source"))
    student_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("students.id"), nullable=True)
    last_synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    status: Mapped[SyncStatusEnum] = mapped_column(SAEnum(SyncStatusEnum, name="sync_status_enum"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
