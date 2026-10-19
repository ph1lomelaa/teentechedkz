"""Inbox eligibility and bulk outcomes agree for the real skipped-link scenarios."""
import asyncio
from collections import Counter
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from app.api.v1.endpoints import notion
from app.models.notion_snapshot import NotionMatchStatus


def snapshot(confidence=1.0, archived=False):
    student_id = uuid4()
    return SimpleNamespace(
        id=uuid4(), suggested_student_id=student_id, suggested_confidence=confidence,
        suggested_student=SimpleNamespace(is_archived=archived, full_name='Student'),
        status=NotionMatchStatus.new, student_id=None, notion_page_id='test-page',
        notion_url=None, full_name='Student', phone_normalized=None, normalized_data={},
        synced_at=None, notion_last_edited_at=None,
    )


@pytest.mark.parametrize('confidence,archived,count,existing,expected', [
    (1.0, False, 1, False, None),
    (.95, False, 1, False, 'Неточное совпадение'),
    (1.0, False, 1, True, 'У студента уже есть страница'),
    (1.0, False, 2, False, 'Несколько страниц'),
    (1.0, True, 1, False, 'архивирован'),
])
def test_safety_policy(confidence, archived, count, existing, expected):
    row = snapshot(confidence, archived)
    reason = notion._bulk_link_block_reason(
        row, Counter({row.suggested_student_id: count}),
        {row.suggested_student_id} if existing else set(),
    )
    assert reason is None if expected is None else expected in reason


class Result:
    def __init__(self, rows): self.rows = rows
    def scalars(self): return self
    def unique(self): return self
    def all(self): return self.rows


def test_list_and_bulk_report_same_three_blocked_suggestions_and_one_safe_link():
    rows = [snapshot(), snapshot(), snapshot(.95), snapshot()]
    candidates = Counter(row.suggested_student_id for row in rows)
    existing = {rows[0].suggested_student_id, rows[1].suggested_student_id}
    db = SimpleNamespace(execute=AsyncMock(return_value=Result(rows)), commit=AsyncMock())
    actor = SimpleNamespace(id=uuid4())
    with patch.object(notion, 'require_access'), \
         patch.object(notion, '_bulk_link_context', AsyncMock(return_value=(candidates, existing))), \
         patch.object(notion, 'log_change', AsyncMock()) as audit:
        listing = asyncio.run(notion.list_snapshots(db, actor, status='new'))
        assert [row['bulk_link_eligible'] for row in listing['items']] == [False, False, False, True]
        assert all(row['link_block_reason'] for row in listing['items'][:3])
        outcome = asyncio.run(notion.link_all_snapshots(db, actor))
    assert outcome['linked'] == 1
    assert outcome['skipped'] == 3
    assert sum(outcome['skipped_reasons'].values()) == 3
    assert all(row.student_id is None for row in rows[:3])
    assert rows[3].student_id == rows[3].suggested_student_id
    audit.assert_awaited_once()
    db.commit.assert_awaited_once()
