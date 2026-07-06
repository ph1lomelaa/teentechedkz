from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AiAnalysisRun(Base):
    __tablename__ = "ai_analysis_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_last_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("telegram_messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft_created", index=True)
    prompt_version: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    input_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict)
    raw_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_output: Mapped[dict] = mapped_column(JSONB, default=dict)
    filter_reasons: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student | None"] = relationship()
    source_last_message: Mapped["TelegramMessage | None"] = relationship()

    __table_args__ = (
        Index("ix_ai_analysis_runs_source_status", "source_type", "source_id", "status", "created_at"),
    )
