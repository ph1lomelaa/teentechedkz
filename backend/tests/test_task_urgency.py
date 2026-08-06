"""Границы срочности задач (task_urgency) — чистая логика, без БД/сети."""
from datetime import date

from app.services.task_urgency import task_urgency


def test_none_when_no_due_date():
    assert task_urgency(None, "open") == "none"


def test_none_when_done_even_if_overdue():
    assert task_urgency(date(2026, 1, 1), "done", today=date(2026, 1, 10)) == "none"


def test_none_when_due_date_is_today():
    assert task_urgency(date(2026, 1, 10), "open", today=date(2026, 1, 10)) == "none"


def test_none_when_due_date_in_future():
    assert task_urgency(date(2026, 1, 15), "open", today=date(2026, 1, 10)) == "none"


def test_yellow_one_day_overdue():
    assert task_urgency(date(2026, 1, 9), "open", today=date(2026, 1, 10)) == "yellow"


def test_yellow_upper_boundary():
    assert task_urgency(date(2026, 1, 8), "open", today=date(2026, 1, 9)) == "yellow"


def test_orange_lower_boundary():
    assert task_urgency(date(2026, 1, 8), "open", today=date(2026, 1, 10)) == "orange"


def test_orange_upper_boundary():
    assert task_urgency(date(2026, 1, 7), "open", today=date(2026, 1, 9)) == "orange"


def test_red_lower_boundary():
    assert task_urgency(date(2026, 1, 7), "open", today=date(2026, 1, 10)) == "red"


def test_red_upper_boundary():
    assert task_urgency(date(2026, 1, 6), "open", today=date(2026, 1, 9)) == "red"


def test_critical_lower_boundary():
    assert task_urgency(date(2026, 1, 6), "open", today=date(2026, 1, 10)) == "critical"


def test_critical_far_overdue():
    assert task_urgency(date(2025, 1, 1), "open", today=date(2026, 1, 10)) == "critical"
