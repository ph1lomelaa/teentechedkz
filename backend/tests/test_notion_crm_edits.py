import asyncio
from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock, patch
import pytest
from app.services import notion_sync
from app.services.notion_field_sync_policy import FieldSide

class Result:
    def __init__(self, values): self.values=values
    def scalars(self): return self
    def all(self): return self.values
    def scalar_one_or_none(self): return self.values[0] if self.values else None

@pytest.mark.parametrize('baseline,notion,expected', [({}, '2026', FieldSide.CRM), ({'intake_year':'2026'},'2026',FieldSide.CRM), ({'intake_year':'2025'},'2026',None)])
def test_explicit_crm_edit_queues_or_preserves_two_sided_conflict(baseline, notion, expected):
    student=SimpleNamespace(id=uuid4(), is_archived=False, full_name='Test', phone='', degree_level=None, intake_year=2027)
    snapshot=SimpleNamespace(id=uuid4(), notion_page_id='page1', notion_last_edited_at=None, normalized_data={'intake_raw':notion}, synced_baseline=baseline)
    db=SimpleNamespace(execute=AsyncMock(side_effect=[Result([snapshot]),Result([])]))
    enqueue=AsyncMock(return_value=SimpleNamespace(direction=SimpleNamespace(value='crm_to_notion' if expected else 'conflict')))
    with patch.object(notion_sync.settings,'ENABLE_NOTION_FIELD_SYNC',True), patch('app.services.notion_field_sync_outbox.enqueue_reconciliation',enqueue):
        state=asyncio.run(notion_sync.enqueue_crm_field_edits(db,student,{'intake_year':2025}))
    assert enqueue.await_args.kwargs['result'].winner is expected
    assert state['state'] == ('queued' if expected else 'conflict')
    assert snapshot.synced_baseline['intake_year'] == baseline.get('intake_year', notion)

@pytest.mark.parametrize('count,state', [(0,'not_linked'),(2,'ambiguous_link')])
def test_crm_edit_never_guesses_a_notion_target(count,state):
    db=SimpleNamespace(execute=AsyncMock(return_value=Result([object()]*count)))
    with patch.object(notion_sync.settings,'ENABLE_NOTION_FIELD_SYNC',True):
        assert asyncio.run(notion_sync.enqueue_crm_field_edits(db,SimpleNamespace(id=uuid4(),is_archived=False),{'intake_year':2026}))['state'] == state
