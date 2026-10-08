"""Transactional persistence and claiming for CRM ↔ Notion field operations.

Callers own the transaction and commit/rollback. Classification is expected to
come from ``notion_field_sync_policy``; this service never picks a winner.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.notion_field_sync import (
    FieldSyncDirection,
    FieldSyncStatus,
    NotionFieldSync,
)
from app.services.notion_field_sync_policy import FieldDecision, FieldSide, ReconciliationResult


def _intent_for_result(result: ReconciliationResult[Any]) -> tuple[FieldSyncDirection, FieldSyncStatus]:
    if result.decision is FieldDecision.CONFLICT and result.winner is None:
        return FieldSyncDirection.conflict, FieldSyncStatus.conflict
    if result.can_propagate and result.winner is FieldSide.CRM:
        return FieldSyncDirection.crm_to_notion, FieldSyncStatus.pending
    if result.can_propagate and result.winner is FieldSide.NOTION:
        return FieldSyncDirection.notion_to_crm, FieldSyncStatus.pending
    return FieldSyncDirection.conflict, FieldSyncStatus.conflict


def build_dedupe_key(
    *, notion_page_id: str, field_key: str, source_revision: str,
    crm_value: Any, notion_value: Any, baseline_value: Any, has_baseline: bool,
) -> str:
    """Stable key for one observed field state; retries cannot enqueue twice."""
    material = {
        "page": notion_page_id,
        "field": field_key,
        "revision": source_revision,
        "crm": crm_value,
        "notion": notion_value,
        "baseline": baseline_value,
        "has_baseline": has_baseline,
    }
    # Shared values must already be canonical JSON values (e.g. enums/dates
    # converted by the field registry). Never stringify unknown objects into
    # collisions that look like valid source values.
    encoded = json.dumps(material, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


async def enqueue_reconciliation(
    session: AsyncSession,
    *,
    notion_snapshot_id: UUID | None,
    student_id: UUID | None,
    notion_page_id: str,
    field_key: str,
    source_revision: str,
    result: ReconciliationResult[Any],
    baseline_value: Any = None,
    has_baseline: bool,
    expected_notion_last_edited_at: datetime | None = None,
    reason: str | None = None,
    now: datetime | None = None,
) -> NotionFieldSync:
    """Persist a policy result once and return its canonical outbox row.

    Conflicts and unresolved/unsafe decisions are retained as review records;
    only policy-selected CRM/Notion winners become pending work items.
    """
    if result.decision is FieldDecision.RESOLVED:
        raise ValueError("resolved fields do not need an outbox item")
    # Validate the exact snapshot before using it as an idempotency key or
    # storing it in JSONB; this intentionally rejects Decimal/date/Enum objects
    # until the caller applies the canonical field serializer.
    for value in (result.crm_value, result.notion_value, baseline_value):
        json.dumps(value, allow_nan=False)
    # Unknown baseline and unsafe clears are persisted for human review.
    direction, status = _intent_for_result(result)

    key = build_dedupe_key(
        notion_page_id=notion_page_id,
        field_key=field_key,
        source_revision=source_revision,
        crm_value=result.crm_value,
        notion_value=result.notion_value,
        baseline_value=baseline_value,
        has_baseline=has_baseline,
    )
    timestamp = now or datetime.now(timezone.utc)
    stmt = (
        insert(NotionFieldSync)
        .values(
            dedupe_key=key,
            notion_snapshot_id=notion_snapshot_id,
            student_id=student_id,
            notion_page_id=notion_page_id,
            field_key=field_key,
            direction=direction,
            status=status,
            decision=result.decision.value,
            crm_value=result.crm_value,
            notion_value=result.notion_value,
            baseline_value=baseline_value,
            has_baseline=has_baseline,
            winning_side=result.winner.value if result.winner else None,
            reason=reason,
            source_revision=source_revision,
            expected_notion_last_edited_at=expected_notion_last_edited_at,
            available_at=timestamp,
            created_at=timestamp,
            updated_at=timestamp,
        )
        .on_conflict_do_nothing(index_elements=[NotionFieldSync.dedupe_key])
        .returning(NotionFieldSync.id)
    )
    inserted_id = (await session.execute(stmt)).scalar_one_or_none()
    if inserted_id is not None:
        return await session.get(NotionFieldSync, inserted_id)
    existing = await session.scalar(
        select(NotionFieldSync).where(NotionFieldSync.dedupe_key == key)
    )
    if existing is None:  # Defensive: concurrent delete between conflict and read.
        raise RuntimeError("outbox row conflicted but could not be reloaded")
    return existing


async def claim_next(
    session: AsyncSession,
    *,
    lease_seconds: int = 120,
    now: datetime | None = None,
    include_dry_run: bool = False,
) -> NotionFieldSync | None:
    """Claim one due write using SKIP LOCKED; no claims while feature is off."""
    if not settings.ENABLE_NOTION_FIELD_SYNC:
        return None
    timestamp = now or datetime.now(timezone.utc)
    candidate = await session.scalar(
        select(NotionFieldSync)
        .where(
            NotionFieldSync.status.in_(
                [FieldSyncStatus.pending, FieldSyncStatus.processing]
                + ([FieldSyncStatus.dry_run] if include_dry_run else [])
            ),
            NotionFieldSync.available_at <= timestamp,
            or_(
                NotionFieldSync.status.in_(
                    [FieldSyncStatus.pending]
                    + ([FieldSyncStatus.dry_run] if include_dry_run else [])
                ),
                NotionFieldSync.locked_until.is_(None),
                NotionFieldSync.locked_until <= timestamp,
            ),
        )
        .order_by(NotionFieldSync.available_at, NotionFieldSync.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if candidate is None:
        return None
    candidate.status = FieldSyncStatus.processing
    candidate.attempts += 1
    candidate.locked_until = timestamp + timedelta(seconds=lease_seconds)
    candidate.updated_at = timestamp
    await session.flush()
    return candidate


async def finish_attempt(
    session: AsyncSession,
    item: NotionFieldSync,
    *,
    succeeded: bool,
    error: str | None = None,
    retry_after_seconds: int = 300,
    now: datetime | None = None,
) -> None:
    """Record write outcome; failed calls remain retryable without data loss."""
    if item.status is not FieldSyncStatus.processing:
        raise ValueError("only a claimed processing item can be completed")
    timestamp = now or datetime.now(timezone.utc)
    item.locked_until = None
    item.last_error = error
    item.updated_at = timestamp
    if succeeded:
        item.status = FieldSyncStatus.succeeded
        item.completed_at = timestamp
    else:
        item.status = FieldSyncStatus.pending
        item.available_at = timestamp + timedelta(seconds=max(1, retry_after_seconds))
    await session.flush()
