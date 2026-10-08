import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from app.models.notion_field_sync import FieldSyncDirection, FieldSyncStatus
from app.models.notion_snapshot import NotionMatchStatus
from app.models.student import DegreeLevel
from app.services import notion_field_sync_runtime as runtime


NOW = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)


class FakeSession:
    def __init__(self):
        self.flush = AsyncMock()


def setup_case(field="full_name", direction=FieldSyncDirection.crm_to_notion):
    student_id = uuid4()
    page_id = "page-1"
    values = {
        "full_name": ("Amina Test", "Old Name"),
        "phone": ("+77001234567", "+77005554433"),
        "degree_level": ("undergraduate", "masters"),
        "intake_year": (2027, "2026"),
    }
    crm, notion = values[field]
    if direction is FieldSyncDirection.notion_to_crm:
        crm, notion = notion, crm
    student = SimpleNamespace(
        id=student_id,
        full_name=crm if field == "full_name" else "Amina Test",
        phone=crm if field == "phone" else "+77001234567",
        degree_level=DegreeLevel(crm) if field == "degree_level" else DegreeLevel.undergraduate,
        intake_year=crm if field == "intake_year" else 2027,
    )
    snapshot = SimpleNamespace(
        id=uuid4(),
        student_id=student_id,
        notion_page_id=page_id,
        status=NotionMatchStatus.linked,
        normalized_data={},
        synced_baseline={"unrelated": "keep"},
    )
    item = SimpleNamespace(
        field_key=field,
        direction=direction,
        notion_page_id=page_id,
        student_id=student_id,
        crm_value=runtime.canonical_profile_value(field, crm),
        notion_value=runtime.canonical_profile_value(field, notion),
        expected_notion_last_edited_at=NOW,
    )
    return item, student, snapshot, crm, notion


def install_fake_notion(monkeypatch, *, field, live_value):
    names = {"full_name": "Student name", "phone": "Номер тел", "degree_level": "Degree", "intake_year": "Intake"}
    name = names[field]
    ptype = "title" if field == "full_name" else "phone_number" if field == "phone" else "select"
    state = {"value": live_value}
    calls = {"writes": 0}
    monkeypatch.setattr(runtime.notion_write, "get_schema", lambda: {name: {"type": ptype, "select": {"options": [{"name": "Undergraduate"}, {"name": "Masters"}, {"name": "2027"}, {"name": "2026"}]}}})
    monkeypatch.setattr(runtime.notion_write, "read_value", lambda _page, _name: state["value"])
    monkeypatch.setattr(runtime.notion_write, "page_last_edited", lambda _page: NOW.isoformat())

    def update(_page, properties, verify=True):
        calls["writes"] += 1
        assert verify is True
        payload = next(iter(properties.values()))
        ptype_key, body = next(iter(payload.items()))
        if ptype_key == "title":
            state["value"] = "".join(part["text"]["content"] for part in body)
        elif ptype_key == "select":
            state["value"] = body["name"]
        else:
            state["value"] = body

    monkeypatch.setattr(runtime.notion_write, "update_page", update)
    return state, calls


def test_dry_run_validates_both_sides_without_writing_or_advancing_baseline(monkeypatch):
    item, student, snapshot, _crm, notion = setup_case()
    install_fake_notion(monkeypatch, field="full_name", live_value=notion)
    before_baseline = dict(snapshot.synced_baseline)

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot))

    assert result.disposition is runtime.RuntimeDisposition.ready
    assert snapshot.synced_baseline == before_baseline
    assert snapshot.normalized_data == {}


def test_crm_to_notion_updates_baseline_only_after_verified_write(monkeypatch):
    item, student, snapshot, crm, notion = setup_case("full_name")
    state, _calls = install_fake_notion(monkeypatch, field="full_name", live_value=notion)

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.applied
    assert state["value"] == crm
    assert snapshot.normalized_data["full_name"] == crm
    assert snapshot.synced_baseline["full_name"] == runtime.canonical_profile_value("full_name", crm)
    assert snapshot.synced_baseline["unrelated"] == "keep"


def test_live_crm_mismatch_supersedes_without_reading_or_writing_notion(monkeypatch):
    item, student, snapshot, _crm, _notion = setup_case("phone")
    student.phone = "+77009990000"
    read = AsyncMock()
    monkeypatch.setattr(runtime.notion_write, "get_schema", read)

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.superseded
    read.assert_not_awaited()
    assert snapshot.synced_baseline == {"unrelated": "keep"}


def test_live_notion_mismatch_supersedes_without_changing_crm(monkeypatch):
    item, student, snapshot, crm, _notion = setup_case("phone")
    install_fake_notion(monkeypatch, field="phone", live_value="+77006667777")

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.superseded
    assert student.phone == crm
    assert snapshot.synced_baseline == {"unrelated": "keep"}


def test_retry_after_remote_write_commits_baseline_without_second_write(monkeypatch):
    item, student, snapshot, crm, _notion = setup_case("full_name")
    _state, calls = install_fake_notion(monkeypatch, field="full_name", live_value=crm)

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.applied
    assert calls["writes"] == 0
    assert snapshot.normalized_data["full_name"] == crm
    assert snapshot.synced_baseline["full_name"] == item.crm_value


def test_notion_to_crm_maps_value_audits_and_advances_baseline_after_flush(monkeypatch):
    item, student, snapshot, crm, notion = setup_case("degree_level", FieldSyncDirection.notion_to_crm)
    install_fake_notion(monkeypatch, field="degree_level", live_value="Бакалавр")
    audit = AsyncMock()
    monkeypatch.setattr(runtime, "log_change", audit)
    session = FakeSession()

    result = asyncio.run(runtime.process_profile_field(session, item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.applied
    assert student.degree_level is DegreeLevel.undergraduate
    audit.assert_awaited_once()
    assert audit.await_args.args[3] == "notion_auto_sync:degree_level"
    session.flush.assert_awaited_once()
    assert snapshot.synced_baseline["degree_level"] == notion
    assert crm == "masters"


def test_unrelated_page_edit_does_not_block_unchanged_field(monkeypatch):
    item, student, snapshot, _crm, notion = setup_case("full_name")
    _state, calls = install_fake_notion(monkeypatch, field="full_name", live_value=notion)
    monkeypatch.setattr(
        runtime.notion_write,
        "page_last_edited",
        lambda _page: (_ for _ in ()).throw(AssertionError("page timestamp is not a field revision")),
    )

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.applied
    assert calls["writes"] == 1
    assert snapshot.synced_baseline["full_name"] == item.crm_value


def test_fields_outside_allowlist_never_write():
    item, student, snapshot, _crm, _notion = setup_case("full_name")
    item.field_key = "pipeline_status"

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot, dry_run=False))

    assert result.disposition is runtime.RuntimeDisposition.unsupported
    assert snapshot.synced_baseline == {"unrelated": "keep"}


def test_dry_run_validates_crm_to_notion_select_mapping_without_external_write(monkeypatch):
    item, student, snapshot, _crm, _notion = setup_case("intake_year")
    state, calls = install_fake_notion(monkeypatch, field="intake_year", live_value="2026")

    result = asyncio.run(runtime.process_profile_field(FakeSession(), item, student=student, snapshot=snapshot))

    assert result.disposition is runtime.RuntimeDisposition.ready
    assert calls["writes"] == 0
    assert state["value"] == "2026"
    assert snapshot.synced_baseline == {"unrelated": "keep"}


def test_dry_run_validates_notion_to_crm_enum_mapping_without_crm_write(monkeypatch):
    item, student, snapshot, _crm, notion = setup_case("degree_level", FieldSyncDirection.notion_to_crm)
    install_fake_notion(monkeypatch, field="degree_level", live_value="Бакалавр")
    audit = AsyncMock()
    monkeypatch.setattr(runtime, "log_change", audit)
    session = FakeSession()

    result = asyncio.run(runtime.process_profile_field(session, item, student=student, snapshot=snapshot))

    assert result.disposition is runtime.RuntimeDisposition.ready
    assert student.degree_level is DegreeLevel.masters
    audit.assert_not_awaited()
    session.flush.assert_not_awaited()
    assert snapshot.synced_baseline == {"unrelated": "keep"}
    assert notion == "undergraduate"


def test_batch_retains_dry_run_as_reviewable_and_claimable_later(monkeypatch):
    item, student, snapshot, _crm, _notion = setup_case("full_name")
    item.id = uuid4()
    item.notion_snapshot_id = snapshot.id
    item.status = FieldSyncStatus.processing
    item.locked_until = NOW
    item.last_error = None
    item.updated_at = NOW
    calls = {"claimed": 0, "include_dry_run": []}

    async def claim(_session, *, include_dry_run=False):
        calls["include_dry_run"].append(include_dry_run)
        calls["claimed"] += 1
        return item if calls["claimed"] == 1 else None

    async def ready(*_args, **_kwargs):
        return runtime.RuntimeResult(runtime.RuntimeDisposition.ready, "full_name", "validated")

    monkeypatch.setattr("app.services.notion_field_sync_outbox.claim_next", claim)
    monkeypatch.setattr(runtime, "process_profile_field", ready)
    session = FakeSession()
    session.commit = AsyncMock()
    entities = {item.id: item, item.student_id: student, item.notion_snapshot_id: snapshot}
    session.get = AsyncMock(side_effect=lambda _model, entity_id: entities.get(entity_id))

    counts = asyncio.run(runtime.process_outbox_batch(session, limit=5, dry_run=True))

    assert counts["dry_run"] == 1
    assert item.status is FieldSyncStatus.dry_run
    assert item.locked_until is None
    assert calls["include_dry_run"] == [False, False]
    assert session.commit.await_count == 2


def test_batch_retries_transient_external_failure(monkeypatch):
    item = SimpleNamespace(
        id=uuid4(), student_id=None, notion_snapshot_id=None,
        status=FieldSyncStatus.processing,
    )
    claims = 0

    async def claim(_session, *, include_dry_run=False):
        nonlocal claims
        claims += 1
        return item if claims == 1 else None

    async def fail(*_args, **_kwargs):
        raise RuntimeError("temporary Notion timeout")

    finish = AsyncMock()
    monkeypatch.setattr("app.services.notion_field_sync_outbox.claim_next", claim)
    monkeypatch.setattr("app.services.notion_field_sync_outbox.finish_attempt", finish)
    monkeypatch.setattr(runtime, "process_profile_field", fail)
    session = FakeSession()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.get = AsyncMock(return_value=item)

    counts = asyncio.run(runtime.process_outbox_batch(session, dry_run=False))

    assert counts["retry"] == 1
    session.rollback.assert_awaited_once()
    finish.assert_awaited_once_with(
        session, item, succeeded=False, error="temporary Notion timeout"
    )


def test_batch_marks_changed_live_data_superseded(monkeypatch):
    item = SimpleNamespace(
        id=uuid4(), student_id=None, notion_snapshot_id=None,
        status=FieldSyncStatus.processing, locked_until=NOW, last_error=None,
        updated_at=NOW,
    )
    claimed = False

    async def claim(_session, *, include_dry_run=False):
        nonlocal claimed
        if claimed:
            return None
        claimed = True
        return item

    async def superseded(*_args, **_kwargs):
        return runtime.RuntimeResult(runtime.RuntimeDisposition.superseded, "phone", "field changed")

    monkeypatch.setattr("app.services.notion_field_sync_outbox.claim_next", claim)
    monkeypatch.setattr(runtime, "process_profile_field", superseded)
    session = FakeSession()
    session.commit = AsyncMock()
    session.get = AsyncMock(return_value=item)

    counts = asyncio.run(runtime.process_outbox_batch(session, dry_run=False))

    assert counts["superseded"] == 1
    assert item.status is FieldSyncStatus.superseded
    assert item.locked_until is None
    assert item.last_error == "field changed"
