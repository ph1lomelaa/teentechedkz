from datetime import date, timedelta

import pytest

from app.schemas.activity import NextStep, StepsSummary
from app.services.activity_board import board_column, is_due_soon, nearest_due, needs_reminder
import uuid


def steps(total=0, pending=0, overdue=0, due=None):
    nxt = NextStep(id=uuid.uuid4(), title='Шаг', due_date=due, state='todo') if total else None
    return StepsSummary(total=total, pending=pending, overdue=overdue, next=nxt)


@pytest.mark.parametrize('decision,status,summary,expected', [
    ('not_interested', 'not_started', steps(), 'closed'),
    ('selected', 'cancelled', steps(2), 'closed'),
    ('selected', 'completed', steps(2, pending=1), 'done'),
    ('suggested', 'not_started', steps(), 'suggested'),
    ('selected', 'in_progress', steps(3, pending=1), 'review'),
    ('selected', 'not_started', steps(), 'planning'),
    # «Заявка подана» без задач всё равно ждёт плана от ментора.
    ('selected', 'submitted', steps(), 'planning'),
    ('selected', 'not_started', steps(3), 'in_work'),
])
def test_board_column(decision, status, summary, expected):
    assert board_column(decision, status, summary) == expected


def test_nearest_due_takes_earliest_of_personal_organizer_and_step():
    s = steps(1, due=date(2026, 10, 20))
    assert nearest_due(date(2026, 10, 15), date(2026, 11, 1), s) == date(2026, 10, 15)
    assert nearest_due(None, None, steps()) is None


def test_due_soon_and_reminders():
    today = date(2026, 10, 3)
    assert is_due_soon('in_work', today + timedelta(days=5), today)
    assert not is_due_soon('done', today, today)
    assert not is_due_soon('in_work', None, today)
    assert needs_reminder('in_work', steps(2, overdue=1), today, today)
    assert not needs_reminder('in_work', steps(2), today, today)
    assert needs_reminder('suggested', steps(), today - timedelta(days=8), today)
    assert not needs_reminder('review', steps(2, pending=1), today - timedelta(days=30), today)
