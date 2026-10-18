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

from sqlalchemy import or_, select, update
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
    expected_contract_id: UUID | None = None,
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

    if expected_contract_id is not None:
        source_revision = hashlib.sha256(f"{source_revision}:contract:{expected_contract_id}".encode()).hexdigest() if not source_revision.startswith(("manual-resolution:", "crm-edit:")) else source_revision
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
            expected_contract_id=expected_contract_id,
            available_at=timestamp,
            created_at=timestamp,
            updated_at=timestamp,
        )
        .on_conflict_do_nothing(index_elements=[NotionFieldSync.dedupe_key])
        .returning(NotionFieldSync.id)
    )
    # The student lock taken by callers serializes competing edit intents.
    # A repeated mirror poll must not replace an explicit pending human choice.
    if not source_revision.startswith(("manual-resolution:", "crm-edit:")):
        intent = await session.scalar(select(NotionFieldSync).where(
            NotionFieldSync.student_id == student_id,
            NotionFieldSync.notion_page_id == notion_page_id,
            NotionFieldSync.field_key == field_key,
            NotionFieldSync.status.in_([FieldSyncStatus.pending, FieldSyncStatus.processing, FieldSyncStatus.dry_run]),
            or_(NotionFieldSync.source_revision.like("manual-resolution:%"), NotionFieldSync.source_revision.like("crm-edit:%")),
        ).order_by(NotionFieldSync.created_at.desc()).limit(1))
        if intent is not None and intent.crm_value == result.crm_value and intent.notion_value == result.notion_value:
            return intent
    inserted_id = (await session.execute(stmt)).scalar_one_or_none()
    existing = await session.get(NotionFieldSync, inserted_id) if inserted_id is not None else await session.scalar(
        select(NotionFieldSync).where(NotionFieldSync.dedupe_key == key).with_for_update()
    )
    if existing is None:
        raise RuntimeError("outbox row conflicted but could not be reloaded")
    # A once-superseded state can recur. Revalidate it rather than silently
    # dropping a legitimate new change because its state hash was seen before.
    if (existing.status in (FieldSyncStatus.superseded, FieldSyncStatus.failed, FieldSyncStatus.succeeded)
            or existing.direction != direction or existing.decision != result.decision.value):
        existing.status = status
        existing.direction = direction
        existing.decision = result.decision.value
        existing.winning_side = result.winner.value if result.winner else None
        existing.expected_contract_id = expected_contract_id
        existing.available_at = timestamp
        existing.locked_until = None
        existing.completed_at = None
        existing.last_error = None
        existing.updated_at = timestamp
    await session.execute(update(NotionFieldSync).where(
        NotionFieldSync.student_id == student_id,
        NotionFieldSync.notion_page_id == notion_page_id,
        NotionFieldSync.field_key == field_key,
        NotionFieldSync.id != existing.id,
        NotionFieldSync.status.in_([FieldSyncStatus.pending, FieldSyncStatus.dry_run, FieldSyncStatus.conflict, FieldSyncStatus.failed]),
    ).values(status=FieldSyncStatus.superseded, locked_until=None, updated_at=timestamp,
             last_error="Reclassified against the current field values"))
    return existing


async def retire_resolved(session, *, snapshot_id, field_key):
    """Keep old comparisons out of the open queue once the sources agree."""
    await session.execute(update(NotionFieldSync).where(
        NotionFieldSync.notion_snapshot_id == snapshot_id,
        NotionFieldSync.field_key == field_key,
        NotionFieldSync.status.in_([FieldSyncStatus.pending, FieldSyncStatus.dry_run, FieldSyncStatus.conflict, FieldSyncStatus.failed]),
    ).values(status=FieldSyncStatus.superseded, locked_until=None,
             updated_at=datetime.now(timezone.utc), last_error="Both sources now agree"))


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
    claim_query = select(NotionFieldSync)
    if settings.NOTION_FIELD_SYNC_STUDENT_IDS:
        claim_query = claim_query.where(NotionFieldSync.student_id.in_(settings.NOTION_FIELD_SYNC_STUDENT_IDS))
    candidate = await session.scalar(
        claim_query
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
        item.status = FieldSyncStatus.failed if getattr(item, "attempts", 0) >= 8 else FieldSyncStatus.pending
        item.available_at = timestamp + timedelta(seconds=max(1, retry_after_seconds))
    await session.flush()
