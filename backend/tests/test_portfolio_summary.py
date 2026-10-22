"""Сводка портфолио: типы опыта, «Сейчас» ученика и очередь ментора."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.schemas.activity import ActivityOut, IntakeOut, NextStep, ParticipationDetail, StepsSummary
from app.services.experience import experience_type
from app.services.portfolio_summary import summarize

TODAY = date(2030, 10, 10)


@pytest.mark.parametrize('kind,expected', [
    ('Конкурс / олимпиада', 'competitions'),
    ('Творческий конкурс', 'competitions'),
    ('Исследовательский конкурс', 'competitions'),
    ('Исследовательский проект', 'research'),
    ('Академия / программа', 'programs'),
    ('Летняя школа', 'programs'),
    ('Курс', 'courses'),
    ('Стажировка', 'internships'),
    ('Волонтёрство', 'social'),
    (None, 'other'),
    ('Что-то новое', 'other'),
])
def test_experience_type(kind, expected):
    assert experience_type(kind) == expected


def steps(total=0, done=0, pending=0, returned=0, overdue=0, state=None, due=None):
    nxt = NextStep(id=uuid.uuid4(), title='Эссе', due_date=due, state=state) if state else None
    return StepsSummary(total=total, done=done, pending=pending, returned=returned, overdue=overdue, next=nxt)


def item(kind='Курс', *, decision='selected', status='in_progress', result='none', summary=None, personal=None, deadline=None, title=None):
    now = datetime(2030, 10, 1, tzinfo=timezone.utc)
    activity = ActivityOut(id=uuid.uuid4(), title=title or kind, kind=kind, created_at=now)
    intake = IntakeOut(id=uuid.uuid4(), activity_id=activity.id, label='Осень', deadline=deadline)
    return ParticipationDetail(id=uuid.uuid4(), student_id=uuid.uuid4(), intake_id=intake.id, mentor_id=None, decision=decision, status=status,
        goal=None, created_at=now, result_review_status=result, activity=activity, intake=intake, steps=summary or StepsSummary(), personal_deadline=personal)


def test_counts_and_experience_tiles():
    data = summarize([
        item('Курс', status='completed', result='approved'),
        item('Стажировка', summary=steps(2, 1, state='todo', due=TODAY + timedelta(days=3))),
        item('Конкурс / олимпиада', decision='suggested', status='not_started'),
        item('Волонтёрство', decision='not_interested', status='not_started'),
    ], None, TODAY)
    assert (data.counts.confirmed, data.counts.active, data.counts.suggested) == (1, 1, 1)
    tiles = {t.key: t for t in data.experience}
    assert tiles['courses'].confirmed == 1 and tiles['internships'].active == 1
    # Рекомендация и отказ не считаются опытом.
    assert tiles['competitions'].active == 0 and tiles['social'].active == 0
    # «Другое» скрыто, пока там пусто.
    assert 'other' not in tiles
    assert data.next_deadline and data.next_deadline.date == TODAY + timedelta(days=3)


def test_student_actions_order_urgent_first_and_mentor_last():
    waiting = item(title='На проверке', summary=steps(2, 1, pending=1, state='pending'))
    returned = item(title='Правки', summary=steps(2, 0, returned=1, state='returned'))
    result = item(title='Итог', summary=steps(2, 2))
    suggested = item(title='Предложено', decision='suggested', status='not_started')
    todo = item(title='Шаг', summary=steps(2, 0, state='todo', due=TODAY + timedelta(days=1)))
    data = summarize([waiting, todo, suggested, result, returned], None, TODAY)
    assert [a.kind for a in data.actions] == ['fix_step', 'do_step', 'submit_result', 'decide', 'step_waiting']
    assert data.counts.waiting_student == 4


def test_mentor_sees_pending_step_even_when_student_has_other_work():
    # Один шаг на проверке, следующий у ученика: ход ученика — do_step, но ментор
    # всё равно должен увидеть работу на проверке.
    both = item(summary=steps(3, 1, pending=1, state='todo'))
    unplanned = item(title='Без плана')
    sent = item(title='Итог отправлен', result='pending', summary=steps(1, 1))
    data = summarize([both, unplanned, sent], None, TODAY)
    assert {a.kind for a in data.mentor_actions} == {'step_waiting', 'plan_waiting', 'result_waiting'}
    assert data.counts.waiting_mentor == 3
    assert [a.kind for a in data.actions if a.participation_id == both.id] == ['do_step']


def test_returned_result_asks_student_to_fix():
    data = summarize([item(result='returned', summary=steps(1, 1))], None, TODAY)
    assert data.actions[0].kind == 'fix_result'
