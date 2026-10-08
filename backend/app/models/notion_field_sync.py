"""Durable work items and unresolved conflicts for CRM ↔ Notion field sync."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FieldSyncStatus(str, enum.Enum):
    pending = "pending"
    processing = "processing"
    dry_run = "dry_run"
    succeeded = "succeeded"
    resolved = "resolved"
    conflict = "conflict"
    failed = "failed"
    superseded = "superseded"


class FieldSyncDirection(str, enum.Enum):
    crm_to_notion = "crm_to_notion"
    notion_to_crm = "notion_to_crm"
    conflict = "conflict"


class NotionFieldSync(Base):
    """Idempotent field-level sync attempt or preserved conflict record.

    Values are snapshots from classification time. Keeping both sides and the
    baseline here makes retries/review auditable without consulting mutable
    live data and prevents a queued operation from silently changing meaning.
    """

    __tablename__ = "notion_field_sync_outbox"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    dedupe_key: Mapped[str] = mapped_column(String(64), unique=True)
    notion_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("notion_snapshots.id", ondelete="SET NULL"), nullable=True, index=True
    )
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True
    )
    notion_page_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    field_key: Mapped[str] = mapped_column(String(100), nullable=False)
    direction: Mapped[FieldSyncDirection] = mapped_column(
        SAEnum(FieldSyncDirection, name="notion_field_sync_direction"), nullable=False
    )
    status: Mapped[FieldSyncStatus] = mapped_column(
        SAEnum(FieldSyncStatus, name="notion_field_sync_status"),
        nullable=False,
        default=FieldSyncStatus.pending,
        server_default=FieldSyncStatus.pending.value,
        index=True,
    )
    decision: Mapped[str] = mapped_column(String(40), nullable=False)
    crm_value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
    notion_value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
    baseline_value: Mapped[object | None] = mapped_column(JSONB, nullable=True)
    has_baseline: Mapped[bool] = mapped_column(nullable=False, default=False, server_default="false")
    winning_side: Mapped[str | None] = mapped_column(String(10), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_revision: Mapped[str] = mapped_column(String(128), nullable=False)
    # Diagnostic page timestamp observed when enqueued; never treated as a
    # per-field edit timestamp or write precondition.
    expected_notion_last_edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_side: Mapped[str | None] = mapped_column(String(10), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
