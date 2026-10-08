import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.api.v1.endpoints import sync
from app.models.notion_field_sync import FieldSyncDirection, FieldSyncStatus
from app.models.notion_snapshot import NotionMatchStatus


class _Scalars:
    def __init__(self, row):
        self.row = row

    def first(self):
        return self.row


class _Result:
    def __init__(self, row):
        self.row = row

    def scalars(self):
        return _Scalars(self.row)


class _Session:
    def __init__(self, row=None, entities=None):
        self.row = row
        self.entities = entities or {}
        self.commit = AsyncMock()
        self.execute = AsyncMock(return_value=_Result(row))

    async def get(self, _model, entity_id):
        return self.entities.get(entity_id)


def test_queue_returns_disabled_without_touching_unmigrated_table():
    db = _Session()
    user = SimpleNamespace(id=uuid4())
    with patch.object(sync.settings, "ENABLE_NOTION_FIELD_SYNC", False), \
         patch.object(sync, "require_access"):
        result = asyncio.run(sync.notion_field_sync_queue(db, user))
    assert result == {"enabled": False, "dry_run": True, "counts": {}, "items": []}
    db.execute.assert_not_awaited()


def test_manual_conflict_choice_is_audited_and_queued_not_applied_immediately():
    student_id = uuid4()
    actor_id = uuid4()
    snapshot_id = uuid4()
    item = SimpleNamespace(
        id=uuid4(), student_id=student_id, notion_snapshot_id=snapshot_id,
        notion_page_id="page-1", field_key="phone", status=FieldSyncStatus.conflict,
        direction=FieldSyncDirection.conflict, crm_value="+77001234567",
        notion_value="+77005554433", baseline_value="+77000000000",
        has_baseline=True, resolved_by_id=None, resolution_side=None, resolved_at=None,
        updated_at=None,
    )
    student = SimpleNamespace(id=student_id, phone="+77001234567", is_archived=False)
    snapshot = SimpleNamespace(
        id=snapshot_id, student_id=student_id, notion_page_id="page-1",
        status=NotionMatchStatus.linked, normalized_data={"phone": "+77005554433"},
    )
    queued = SimpleNamespace(id=uuid4())
    db = _Session(item, {student_id: student, snapshot_id: snapshot})
    user = SimpleNamespace(id=actor_id)
    audit = AsyncMock()
    enqueue = AsyncMock(return_value=queued)
    body = sync.ResolveNotionFieldSyncBody(side="crm")
    with patch.object(sync.settings, "ENABLE_NOTION_FIELD_SYNC", True), \
         patch.object(sync, "require_access"), \
         patch("app.services.notion_field_sync_outbox.enqueue_reconciliation", enqueue), \
         patch.object(sync, "log_change", audit):
        result = asyncio.run(sync.resolve_notion_field_sync_conflict(item.id, body, db, user))

    assert result == {"resolved": True, "side": "crm", "queued_item_id": str(queued.id)}
    assert item.status is FieldSyncStatus.resolved
    assert item.resolution_side == "crm"
    assert item.resolved_by_id == actor_id
    enqueue.assert_awaited_once()
    queued_result = enqueue.await_args.kwargs["result"]
    assert queued_result.winner.value == "crm"
    assert audit.await_count == 1
    db.commit.assert_awaited_once()


def test_conflict_choice_rejects_changed_crm_value_and_keeps_item_open():
    student_id, snapshot_id = uuid4(), uuid4()
    item = SimpleNamespace(
        id=uuid4(), student_id=student_id, notion_snapshot_id=snapshot_id,
        notion_page_id="page-1", field_key="phone", status=FieldSyncStatus.conflict,
        crm_value="+77001234567", notion_value="+77005554433", baseline_value=None,
        has_baseline=False,
    )
    student = SimpleNamespace(id=student_id, phone="+77009999999", is_archived=False)
    snapshot = SimpleNamespace(
        id=snapshot_id, student_id=student_id, notion_page_id="page-1",
        status=NotionMatchStatus.linked, normalized_data={"phone": "+77005554433"},
    )
    db = _Session(item, {student_id: student, snapshot_id: snapshot})
    with patch.object(sync.settings, "ENABLE_NOTION_FIELD_SYNC", True), \
         patch.object(sync, "require_access"), \
         pytest.raises(Exception) as error:
        asyncio.run(sync.resolve_notion_field_sync_conflict(
            item.id, sync.ResolveNotionFieldSyncBody(side="crm"), db,
            SimpleNamespace(id=uuid4()),
        ))
    assert "Данные изменились" in str(error.value)
    assert item.status is FieldSyncStatus.conflict
    db.commit.assert_not_awaited()
