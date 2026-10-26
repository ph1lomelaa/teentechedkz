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
    overdue = item(title='Просрочка', summary=steps(2, 0, overdue=1, state='overdue', due=TODAY - timedelta(days=4)))
    data = summarize([waiting, todo, suggested, result, returned, overdue], None, TODAY)
    # Правки → просрочка → рекомендация → итог → ближайший шаг → ожидание ментора.
    assert [a.kind for a in data.actions] == ['fix_step', 'do_step', 'decide', 'submit_result', 'do_step', 'step_waiting']
    assert data.actions[1].overdue and data.actions[1].overdue_days == 4
    assert data.counts.waiting_student == 5


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


def test_experience_labels_match_frontend_dictionary():
    """Подписи типов опыта одинаковые на сервере и в словаре фронта."""
    import re
    from pathlib import Path
    from app.services.experience import EXPERIENCE_TYPES

    dictionary = Path(__file__).resolve().parents[2] / 'frontend/src/lib/portfolio/dictionary.ts'
    if not dictionary.exists():
        import pytest
        pytest.skip('frontend is not mounted')
    pairs = dict(re.findall(r"key: '(\w+)', label: '([^']+)'", dictionary.read_text(encoding='utf-8')))
    assert pairs == dict(EXPERIENCE_TYPES)


def test_shelf_cells_filled_in_work_and_recommended():
    data = summarize([
        item('Курс', status='completed', result='approved', title='Курс Python'),
        item('Стажировка', summary=steps(2, 1, state='todo'), title='IT-стажировка'),
        item('Конкурс / олимпиада', decision='suggested', status='not_started', title='Олимпиада'),
        item('Что-то новое', status='completed', result='approved'),
    ], None, TODAY)
    cells = {c.key: c for c in data.shelf}
    assert len(data.shelf) == 6 and 'other' not in cells
    assert cells['courses'].state == 'filled' and cells['courses'].achievements[0].title == 'Курс Python'
    assert cells['internships'].state == 'in_work' and cells['internships'].in_work[0].title == 'IT-стажировка'
    assert cells['competitions'].state == 'empty' and cells['competitions'].recommended[0].title == 'Олимпиада'


def test_decide_by_defaults_ten_days_before_deadline_but_not_before_tomorrow():
    from app.services.activity_board import decide_by
    from types import SimpleNamespace as NS
    suggested = NS(decision='suggested', decide_by=None)
    assert decide_by(suggested, NS(deadline=TODAY + timedelta(days=30)), TODAY) == TODAY + timedelta(days=20)
    assert decide_by(suggested, NS(deadline=TODAY + timedelta(days=5)), TODAY) == TODAY + timedelta(days=1)
    assert decide_by(suggested, NS(deadline=None), TODAY) is None
    assert decide_by(NS(decision='suggested', decide_by=TODAY), NS(deadline=None), TODAY) == TODAY
    assert decide_by(NS(decision='selected', decide_by=None), NS(deadline=TODAY), TODAY) is None


def test_pending_step_is_tracked_apart_from_next_step():
    from types import SimpleNamespace as NS
    from app.api.v1.endpoints.activities import summarize_steps
    from app.models.roadmap import RoadmapItemStatus, TaskPriority, TaskReviewStatus
    def task(title, review, due, completed=None):
        return NS(id=uuid.uuid4(), title=title, status=RoadmapItemStatus.in_progress, review_status=review, priority=TaskPriority.required,
                  due_date=due, position=0, completed_at=completed, requires_review=True, review_comment=None, reviewed_at=None)
    sent = task('Эссе', TaskReviewStatus.pending, TODAY + timedelta(days=5))
    late = task('Отклик', TaskReviewStatus.none, TODAY - timedelta(days=3))
    summary = summarize_steps([sent, late], TODAY)
    assert summary.next.title == 'Отклик' and summary.next.state == 'overdue'
    assert summary.pending_step.title == 'Эссе' and summary.pending_step.index == 1


def test_intake_label_from_deadline_season():
    from app.services.activity_board import intake_label
    assert intake_label('', date(2026, 10, 1), 'fixed') == 'Осень 2026'
    assert intake_label('', date(2026, 12, 15), 'fixed') == 'Зима 2027'
    assert intake_label('', date(2027, 2, 1), 'fixed') == 'Зима 2027'
    assert intake_label(' ', None, 'rolling') == 'Принимают постоянно'
    assert intake_label('Весенний поток', date(2026, 10, 1), 'fixed') == 'Весенний поток'
