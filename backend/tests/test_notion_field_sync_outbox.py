from app.models.notion_field_sync import FieldSyncDirection, FieldSyncStatus
from app.services.notion_field_sync_outbox import _intent_for_result, build_dedupe_key
from app.services.notion_field_sync_policy import (
    FieldDecision,
    FieldSide,
    ReconciliationResult,
)
import asyncio
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


def test_outbox_key_is_deterministic_and_tracks_observed_revision():
    values = dict(
        notion_page_id="page-1",
        field_key="pipeline_status",
        source_revision="2026-10-08T10:00:00Z",
        crm_value="active_work",
        notion_value="on_visa",
        baseline_value="active_work",
        has_baseline=True,
    )
    first = build_dedupe_key(**values)
    assert build_dedupe_key(**values) == first
    assert build_dedupe_key(**{**values, "notion_value": "completed_admitted"}) != first
    assert build_dedupe_key(**{**values, "source_revision": "2026-10-08T10:01:00Z"}) != first


def test_outbox_key_rejects_unserialized_field_values():
    with pytest.raises(TypeError):
        build_dedupe_key(
            notion_page_id="page-1",
            field_key="signed_date",
            source_revision="r1",
            crm_value=date(2026, 10, 8),
            notion_value=None,
            baseline_value=None,
            has_baseline=True,
        )


def test_crm_winner_becomes_pending_crm_to_notion_work():
    result = ReconciliationResult(
        FieldDecision.CRM_CHANGED, crm_value="new", notion_value="old", winner=FieldSide.CRM
    )

    assert _intent_for_result(result) == (
        FieldSyncDirection.crm_to_notion,
        FieldSyncStatus.pending,
    )


def test_notion_winner_becomes_pending_notion_to_crm_work():
    result = ReconciliationResult(
        FieldDecision.NOTION_CHANGED, crm_value="old", notion_value="new", winner=FieldSide.NOTION
    )

    assert _intent_for_result(result) == (
        FieldSyncDirection.notion_to_crm,
        FieldSyncStatus.pending,
    )


def test_unordered_conflict_preserves_both_sides_for_review():
    result = ReconciliationResult(
        FieldDecision.CONFLICT, crm_value="CRM edit", notion_value="Notion edit"
    )

    direction, status = _intent_for_result(result)
    assert direction is FieldSyncDirection.conflict
    assert status is FieldSyncStatus.conflict
    assert result.crm_value == "CRM edit"
    assert result.notion_value == "Notion edit"


def test_unknown_baseline_and_unsafe_clear_are_never_scheduled_as_writes():
    for decision in (FieldDecision.UNKNOWN_BASELINE, FieldDecision.UNSAFE_CLEAR):
        result = ReconciliationResult(decision, crm_value=None, notion_value="kept")
        assert _intent_for_result(result) == (
            FieldSyncDirection.conflict,
            FieldSyncStatus.conflict,
        )


def test_notion_sync_enqueues_only_gated_reviewed_profile_fields():
    from app.services import notion_sync

    enqueue = AsyncMock()
    snapshot = SimpleNamespace(
        id=uuid.uuid4(), notion_page_id="page-1", notion_last_edited_at=datetime.now(timezone.utc),
        synced_baseline={"full_name": "Было", "_initialized_fields": ["full_name"]},
    )
    student = SimpleNamespace(id=uuid.uuid4())
    canon = {
        "full_name": ("Было", "Стало CRM"),
        "phone": ("+77000000000", "+77000000000"),
        "pipeline_status": ("on_visa", "active_work"),
    }
    with patch.object(notion_sync.settings, "ENABLE_NOTION_FIELD_SYNC", True), \
         patch("app.services.notion_field_sync_outbox.enqueue_reconciliation", enqueue):
        asyncio.run(notion_sync._enqueue_field_reconciliation(None, snapshot, student, None, canon))

    calls = {call.kwargs["field_key"]: call.kwargs for call in enqueue.await_args_list}
    assert set(calls) == {"full_name", "pipeline_status"}
    assert calls["full_name"]["result"].decision is FieldDecision.CRM_CHANGED
    assert calls["pipeline_status"]["result"].winning_value == "on_visa"


def test_notion_sync_does_not_enqueue_when_disabled():
    from app.services import notion_sync

    with patch.object(notion_sync.settings, "ENABLE_NOTION_FIELD_SYNC", False):
        asyncio.run(notion_sync._enqueue_field_reconciliation(None, None, None, None, {}))
from datetime import date

import pytest


def test_first_activation_prefers_notion_over_historical_crm_discrepancy():
    from app.services import notion_sync
    snapshot = SimpleNamespace(id=uuid.uuid4(), notion_page_id='p1', notion_last_edited_at=None,
        synced_baseline={'intake_year':'2026'})
    enqueue=AsyncMock()
    with patch.object(notion_sync.settings,'ENABLE_NOTION_FIELD_SYNC',True), patch('app.services.notion_field_sync_outbox.enqueue_reconciliation',enqueue):
        asyncio.run(notion_sync._enqueue_field_reconciliation(None,snapshot,SimpleNamespace(id=uuid.uuid4()),None,{'intake_year':('2026','2027')}))
    assert enqueue.await_args.kwargs['result'].winning_value == '2026'


def test_bootstrap_keeps_audited_portal_edit_for_review_without_baseline():
    from app.services import notion_sync
    snapshot=SimpleNamespace(id=uuid.uuid4(),notion_page_id='p1',notion_last_edited_at=None,synced_baseline={})
    enqueue=AsyncMock()
    with patch.object(notion_sync.settings,'ENABLE_NOTION_FIELD_SYNC',True), patch('app.services.notion_field_sync_outbox.enqueue_reconciliation',enqueue):
        asyncio.run(notion_sync._enqueue_field_reconciliation(None,snapshot,SimpleNamespace(id=uuid.uuid4()),None,{'intake_year':('2026','2027')},manual_fields={'intake_year'}))
    assert enqueue.await_args.kwargs['result'].winner is None
    assert enqueue.await_args.kwargs['result'].decision is FieldDecision.UNKNOWN_BASELINE


def test_bootstrap_propagates_audited_portal_edit_when_notion_is_unchanged():
    from app.services import notion_sync
    snapshot=SimpleNamespace(id=uuid.uuid4(),notion_page_id='p1',notion_last_edited_at=None,synced_baseline={'intake_year':'2026'})
    enqueue=AsyncMock()
    with patch.object(notion_sync.settings,'ENABLE_NOTION_FIELD_SYNC',True), patch('app.services.notion_field_sync_outbox.enqueue_reconciliation',enqueue):
        asyncio.run(notion_sync._enqueue_field_reconciliation(None,snapshot,SimpleNamespace(id=uuid.uuid4()),None,{'intake_year':('2026','2027')},manual_fields={'intake_year'}))
    assert enqueue.await_args.kwargs['result'].winner is FieldSide.CRM
