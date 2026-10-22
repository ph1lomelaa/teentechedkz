from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4
import asyncio
from unittest.mock import AsyncMock
import pytest
from app.services.notion_field_sync_report import describe_field
from app.services import notion_field_sync_runtime as runtime
from app.models.notion_snapshot import NotionMatchStatus
from app.models.notion_field_sync import FieldSyncDirection
from app.models.contract import PipelineStatus


def test_old_conflict_has_no_invented_winner():
    row = describe_field('phone', crm='new-site', notion='new-notion', baseline='old', has_baseline=True)
    assert row['eligible'] is False
    assert row['winner'] is None
    assert 'время' in row['reason']


def test_one_sided_change_is_ready_and_ambiguous_contract_is_blocked():
    row = describe_field('client_fee', crm='200.00', notion='100.00', baseline='100.00', has_baseline=True)
    assert row['eligible'] and row['winner'] == 'crm'
    row = describe_field('client_fee', crm='200.00', notion='100.00', baseline='100.00', has_baseline=True, contract_count=2)
    assert not row['eligible']


def test_missing_baseline_and_clear_are_never_auto_applied():
    assert not describe_field('full_name', crm='A', notion='B', baseline=None, has_baseline=False)['eligible']
    assert not describe_field('phone', crm=None, notion='B', baseline='B', has_baseline=True)['eligible']


@pytest.mark.parametrize(('field','value','expected'), [
    ('client_fee','123 456,70','123456.70'), ('client_fee', 'NaN', None),
    ('client_remaining_date','2026-11-01','2026-11-01'),
    ('pipeline_status','Работа окончена-Поступил','completed_admitted'),
    ('pipeline_status','Неизвестная новая опция',None),
])
def test_extended_fields_use_strict_canonical_values(field, value, expected):
    assert runtime.canonical_profile_value(field, value) == expected


@pytest.mark.parametrize(('field','old','new','ptype','expected'), [
    ('client_fee', Decimal('100.00'), '200', 'number', Decimal('200.00')),
    ('signed_date', date(2026,1,1), '2026-10-16', 'date', date(2026,10,16)),
    ('pipeline_status', PipelineStatus.active_work, 'На визе', 'select', PipelineStatus.on_visa),
])
def test_notion_changes_update_the_contract_and_audit_not_the_student(monkeypatch, field, old, new, ptype, expected):
    student = SimpleNamespace(id=uuid4())
    contract = SimpleNamespace(id=uuid4(), **{runtime.CONTRACT_FIELD_ATTR[field]: old})
    snapshot = SimpleNamespace(notion_page_id='page', status=NotionMatchStatus.linked, student_id=student.id, normalized_data={}, synced_baseline={})
    item = SimpleNamespace(field_key=field, notion_page_id='page', student_id=student.id, direction=FieldSyncDirection.notion_to_crm, crm_value=runtime.canonical_profile_value(field,old), notion_value=runtime.canonical_profile_value(field,new))
    monkeypatch.setattr(runtime.notion_write,'get_schema',lambda: {})
    monkeypatch.setattr(runtime,'_resolve_notion_property',lambda *a,**k: ('property',ptype))
    monkeypatch.setattr(runtime.notion_write,'read_value',lambda *a: new)
    audit=AsyncMock();monkeypatch.setattr(runtime,'log_change',audit)
    result=asyncio.run(runtime.process_profile_field(SimpleNamespace(flush=AsyncMock()),item,student=student,snapshot=snapshot,contract=contract,dry_run=False))
    assert result.disposition is runtime.RuntimeDisposition.applied
    assert getattr(contract,runtime.CONTRACT_FIELD_ATTR[field]) == expected
    assert not hasattr(student,field)
    assert audit.await_args.args[1:3] == ('contract',contract.id)
    assert snapshot.synced_baseline[field] == runtime.canonical_profile_value(field,new)


def test_formula_is_never_a_writable_finance_target():
    assert runtime._crm_to_notion_payload('client_fee','100',{},'Total','formula') is None


def test_foreign_currency_and_float_precision_are_not_silently_written():
    row = describe_field('client_fee', crm='200.00', notion='100.00', baseline='100.00', has_baseline=True, contract_currency='USD')
    assert not row['eligible']
    assert runtime._crm_to_notion_payload('client_fee', '9999999999999999.99', {}, 'Fee', 'number') is None


def test_report_apply_rejects_a_stale_revision_before_queueing(monkeypatch):
    from app.api.v1.endpoints import sync
    from fastapi import HTTPException
    monkeypatch.setattr(sync, 'require_access', lambda *a: None)
    monkeypatch.setattr(sync.settings, 'ENABLE_NOTION_FIELD_SYNC', True)
    monkeypatch.setattr(sync, 'notion_field_report', AsyncMock(return_value={'revision':'new'}))
    db=SimpleNamespace(commit=AsyncMock())
    with pytest.raises(HTTPException) as error:
        asyncio.run(sync.apply_notion_field_report(sync.ApplyNotionFieldReportBody(revision='old'),db,SimpleNamespace(id=uuid4())))
    assert error.value.status_code == 409
    db.commit.assert_not_awaited()


def test_disabled_writer_never_applies_a_report(monkeypatch):
    from app.api.v1.endpoints import sync
    from fastapi import HTTPException
    monkeypatch.setattr(sync, 'require_access', lambda *a: None)
    monkeypatch.setattr(sync.settings, 'ENABLE_NOTION_FIELD_SYNC', False)
    db=SimpleNamespace(commit=AsyncMock())
    with pytest.raises(HTTPException) as error:
        asyncio.run(sync.apply_notion_field_report(sync.ApplyNotionFieldReportBody(revision='x'),db,SimpleNamespace(id=uuid4())))
    assert error.value.status_code == 409
    db.commit.assert_not_awaited()
