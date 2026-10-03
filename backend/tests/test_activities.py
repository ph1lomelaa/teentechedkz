import asyncio
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from app.api.v1.endpoints import activities as api
from app.models.activity import Activity, ActivityIntake, StudentActivity
from app.models.user import UserRole
from app.schemas.activity import ActivityCreate, IntakeCreate, ParticipationCreate


def result(value, rows=()):
    return SimpleNamespace(scalar_one_or_none=lambda: value,
                           scalars=lambda: SimpleNamespace(all=lambda: list(rows)))


def database(publication='published'):
    activity = Activity(id=uuid.uuid4(), title='Конкурс', publication=publication)
    intake = ActivityIntake(id=uuid.uuid4(), activity_id=activity.id, label='2026')
    db = SimpleNamespace(get=AsyncMock(side_effect=[intake, activity]), execute=AsyncMock(return_value=result(None)), add=Mock(), commit=AsyncMock(), rollback=AsyncMock(), refresh=AsyncMock())
    return db, intake


def test_only_admin_imports_catalogue():
    api.require_catalog_admin(SimpleNamespace(role=UserRole.admin))
    for role in (UserRole.student, UserRole.mentor, UserRole.mzk_manager, UserRole.academic_head):
        with pytest.raises(HTTPException) as exc:
            api.require_catalog_admin(SimpleNamespace(role=role))
        assert exc.value.status_code == 403


def test_mentors_and_heads_edit_catalogue():
    for role in (UserRole.admin, UserRole.academic_head, UserRole.mentor):
        api.require_catalog_editor(SimpleNamespace(role=role, permission_grants=[]))
    for role in (UserRole.student, UserRole.mzk_manager):
        with pytest.raises(HTTPException) as exc:
            api.require_catalog_editor(SimpleNamespace(role=role, permission_grants=[]))
        assert exc.value.status_code == 403


@pytest.mark.parametrize('publication', ['draft', 'archived'])
def test_hidden_activity_cannot_be_selected(publication):
    db, intake = database(publication)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id)))
    assert exc.value.status_code == 404
    db.add.assert_not_called()


def test_repeated_selection_preserves_existing_progress():
    db, intake = database()
    existing = StudentActivity(status='in_progress', goal='Свой план')
    db.execute.return_value = result(existing)
    actual = asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id, goal='Другой план')))
    assert actual is existing
    assert actual.goal == 'Свой план'
    db.add.assert_not_called()


def test_concurrent_selection_returns_winner_after_rollback():
    db, intake = database()
    existing = StudentActivity(id=uuid.uuid4())
    # поиск существующего, менторы портфолио, повторный поиск после отката
    db.execute.side_effect = [result(None), result(None), result(existing)]
    db.commit.side_effect = IntegrityError('insert', {}, Exception('duplicate'))
    assert asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id))) is existing
    db.rollback.assert_awaited_once()


def test_selection_uses_resolved_student_not_body():
    db, intake = database()
    student_id = uuid.uuid4()
    asyncio.run(api.select_my_activity(ParticipationCreate(intake_id=intake.id), db, SimpleNamespace(id=student_id, user_id=uuid.uuid4())))
    saved = db.add.call_args.args[0]
    assert saved.student_id == student_id
    with pytest.raises(ValidationError):
        ParticipationCreate(intake_id=intake.id, student_id=uuid.uuid4())


def test_unknown_cost_and_dates_are_not_invented():
    intake = IntakeCreate(label='Набор')
    assert intake.cost_state == 'unknown'
    assert intake.mode == 'unknown'
    assert intake.deadline is None
    with pytest.raises(ValidationError):
        ActivityCreate(title='   ')


def test_drafts_invisible_to_student():
    db = SimpleNamespace(get=AsyncMock(return_value=Activity(publication='draft')),
                         execute=AsyncMock(return_value=SimpleNamespace(first=lambda: None)))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.visible_activity(db, uuid.uuid4(), SimpleNamespace(role=UserRole.student, id=uuid.uuid4())))
    assert exc.value.status_code == 404


def test_recommended_draft_visible_only_to_its_student():
    draft = Activity(publication='draft')
    db = SimpleNamespace(get=AsyncMock(return_value=draft),
                         execute=AsyncMock(return_value=SimpleNamespace(first=lambda: (uuid.uuid4(),))))
    assert asyncio.run(api.visible_activity(db, uuid.uuid4(), SimpleNamespace(role=UserRole.student, id=uuid.uuid4()))) is draft


def test_staff_can_assign_draft_with_explicit_origin():
    from app.schemas.activity import StaffParticipationCreate
    db, intake = database('draft')
    actor_id = uuid.uuid4()
    asyncio.run(api.select_participation(db, uuid.uuid4(), StaffParticipationCreate(intake_id=intake.id, decision='suggested'),
        allow_draft=True, source='staff', actor_id=actor_id))
    saved = db.add.call_args.args[0]
    assert saved.selection_source == 'staff'
    assert saved.selected_by_id == actor_id
    assert saved.decision == 'suggested'


def test_student_cannot_fake_staff_origin():
    with pytest.raises(ValidationError):
        ParticipationCreate(intake_id=uuid.uuid4(), selection_source='staff', decision='suggested')


def test_repeated_assignment_preserves_student_origin():
    db, intake = database()
    existing = StudentActivity(selection_source='student', decision='selected', status='in_progress')
    db.execute.return_value = result(existing)
    actual = asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id), source='staff'))
    assert actual.selection_source == 'student'
    assert actual.status == 'in_progress'


def test_student_cannot_read_global_staff_tables():
    student = SimpleNamespace(role=UserRole.student)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.catalog_rows(None, student))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.staff_participations(None, student, student_id=None, activity_id=None, q='', decision=None,
            status=None, source=None, offset=0, limit=25))
    assert exc.value.status_code == 403


def test_single_portfolio_mentor_becomes_responsible():
    db, intake = database()
    mentor = SimpleNamespace(id=uuid.uuid4(), name='Айгерим')
    db.execute.side_effect = [result(None), result(None, rows=[mentor])]
    asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id)))
    assert db.add.call_args.args[0].mentor_id == mentor.id


def test_several_portfolio_mentors_are_not_guessed():
    db, intake = database()
    mentors = [SimpleNamespace(id=uuid.uuid4(), name=n) for n in ('А', 'Б')]
    db.execute.side_effect = [result(None), result(None, rows=mentors)]
    asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id)))
    assert db.add.call_args.args[0].mentor_id is None


def _task(title, *, status='planned', review='none', due=None, priority='required', position=0):
    from app.models.roadmap import RoadmapItemStatus, TaskPriority, TaskReviewStatus
    return SimpleNamespace(id=uuid.uuid4(), title=title, status=RoadmapItemStatus(status),
                           review_status=TaskReviewStatus(review), due_date=due,
                           priority=TaskPriority(priority), position=position)


def test_steps_summary_counts_required_and_picks_most_urgent():
    from datetime import date, timedelta
    today = date(2026, 10, 3)
    tasks = [
        _task('Регистрация', status='done', review='approved'),
        _task('Черновик', review='returned', due=today - timedelta(days=1)),
        _task('Модуль 1', review='pending', due=today + timedelta(days=3)),
        _task('Питч', due=today + timedelta(days=18)),
        _task('Доп. чтение', priority='optional', due=today - timedelta(days=5)),
    ]
    summary = api.summarize_steps(tasks, today)
    assert (summary.total, summary.done) == (4, 1)  # необязательная не в знаменателе
    assert (summary.pending, summary.returned, summary.overdue) == (1, 1, 1)
    assert (summary.next.title, summary.next.state) == ('Черновик', 'returned')


def test_steps_summary_waits_for_mentor_when_only_pending_left():
    summary = api.summarize_steps([_task('Модуль', review='pending')])
    assert summary.next.state == 'pending'
    assert api.summarize_steps([]).next is None


def test_catalog_card_uses_upcoming_deadline_not_past_one():
    from datetime import date
    today = date(2026, 10, 3)
    past = ActivityIntake(label='2025', mode='fixed', deadline=date(2025, 11, 1))
    rolling = ActivityIntake(label='Постоянно', mode='rolling', deadline=None)
    soon = ActivityIntake(label='2026', mode='fixed', deadline=date(2026, 11, 1))
    assert api.nearest_intake([past, rolling, soon], today) is soon
    assert api.nearest_intake([past, rolling], today) is rolling
    assert api.nearest_intake([past], today) is None


def test_staff_recommendation_keeps_reason_and_personal_deadline_apart():
    from datetime import date
    from app.schemas.activity import StaffParticipationCreate
    db, intake = database()
    body = StaffParticipationCreate(intake_id=intake.id, recommendation_note='Подходит к твоему проекту', personal_deadline=date(2026, 10, 15))
    asyncio.run(api.select_participation(db, uuid.uuid4(), body, source='staff', actor_id=uuid.uuid4()))
    saved = db.add.call_args.args[0]
    assert saved.recommendation_note == 'Подходит к твоему проекту'
    assert saved.personal_deadline == date(2026, 10, 15)
    assert intake.deadline is None  # срок организатора не тронут
    assert saved.goal is None  # причина ментора не становится целью ученика


def test_repeated_recommendation_does_not_overwrite_existing():
    from app.schemas.activity import StaffParticipationCreate
    db, intake = database()
    existing = StudentActivity(decision='selected', recommendation_note=None)
    db.execute.return_value = result(existing)
    actual = asyncio.run(api.select_participation(db, uuid.uuid4(), StaffParticipationCreate(intake_id=intake.id, recommendation_note='Ещё раз'), source='staff'))
    assert actual is existing and existing.recommendation_note is None and existing.decision == 'selected'
    db.add.assert_not_called()


def test_review_issues_name_missing_data_without_inventing():
    activity = Activity(title='Олимпиада', source_url=None, description='')
    assert api.review_issues(activity, [], None) == ['Нет ссылки организатора', 'Нет описания', 'Нет наборов']
    unknown = ActivityIntake(label='2026', mode='unknown', deadline=None, cost_state='unknown')
    assert api.review_issues(Activity(title='x', source_url='https://a.kz', description='d'), [unknown], unknown) == ['Сроки не уточнены', 'Стоимость не уточнена']
    ok = ActivityIntake(label='2026', mode='rolling', deadline=None, cost_state='free')
    assert api.review_issues(Activity(title='x', source_url='https://a.kz', description='d'), [ok], ok) == []


def test_mentor_activity_scope_is_own_students_only():
    from app.services import mentor_scope
    mine = uuid.uuid4()
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [mine]))))
    mentor = SimpleNamespace(role=UserRole.mentor, id=uuid.uuid4())
    assert asyncio.run(mentor_scope.activity_student_ids(db, mentor)) == {mine}
    asyncio.run(mentor_scope.require_activity_student(db, mine, mentor))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(mentor_scope.require_activity_student(db, uuid.uuid4(), mentor))
    assert exc.value.status_code == 404
    for role in (UserRole.admin, UserRole.academic_head, UserRole.mzk_manager):
        assert asyncio.run(mentor_scope.activity_student_ids(db, SimpleNamespace(role=role, id=uuid.uuid4()))) is None


def test_conditions_check_date_remains_a_date_for_sqlalchemy():
    from datetime import date
    body = ActivityCreate(title='Конкурс', conditions_checked_at=date(2026, 10, 3), source_url='https://example.org')
    data = api.activity_values(body)
    assert data['conditions_checked_at'] == date(2026, 10, 3)
    assert isinstance(data['source_url'], str)


def test_closed_intake_rejects_new_selection():
    from datetime import date, timedelta
    db, intake = database()
    intake.deadline = date.today() - timedelta(days=1)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(api.select_participation(db, uuid.uuid4(), ParticipationCreate(intake_id=intake.id)))
    assert exc.value.status_code == 409
    db.add.assert_not_called()


def test_past_rolling_deadline_is_not_an_open_intake():
    from datetime import date, timedelta
    past = ActivityIntake(mode='rolling', deadline=date.today() - timedelta(days=1))
    assert api.nearest_intake([past], date.today()) is None


def test_progress_segments_do_not_mark_optional_review_as_required_review():
    from datetime import date
    from app.models.roadmap import RoadmapItemStatus, TaskReviewStatus, TaskPriority
    tasks = [SimpleNamespace(id=uuid.uuid4(), title='Обязательный шаг', status=RoadmapItemStatus.planned,
        review_status=TaskReviewStatus.none, priority=TaskPriority.required, due_date=None, position=0),
        SimpleNamespace(id=uuid.uuid4(), title='Дополнительный шаг', status=RoadmapItemStatus.planned,
        review_status=TaskReviewStatus.pending, priority=TaskPriority.optional, due_date=None, position=1)]
    summary = api.summarize_steps(tasks, date.today())
    assert summary.total == 1 and summary.pending == 1
    assert summary.segment_states == ['todo']
