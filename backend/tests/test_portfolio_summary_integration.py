"""Сводка портфолио, фокус ментора и обзор по ученикам — на настоящей БД.

PORTFOLIO_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_portfolio_check_... pytest ...
"""
import asyncio
import os
import uuid
from datetime import date, timedelta

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.endpoints import activities, learner_tasks, portfolio_workflow, roadmaps, workspace
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.activity import Activity, ActivityIntake
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('PORTFOLIO_TEST_DATABASE_URL', '')
pytestmark = pytest.mark.skipif(not URL, reason='Requires an isolated Portfolio UP test database')


def test_portfolio_summary_focus_and_overview(monkeypatch):
    assert '/tte_portfolio_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run(monkeypatch))


async def run(monkeypatch):
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:10]
    async with sessions() as db:
        mentor = User(name='Summary Mentor', email=f's-mentor-{suffix}@example.test', hashed_password='x', role=UserRole.mentor)
        stranger_mentor = User(name='Other Mentor', email=f's-other-{suffix}@example.test', hashed_password='x', role=UserRole.mentor)
        learner = User(name='Summary Learner', email=f's-student-{suffix}@example.test', hashed_password='x', role=UserRole.student)
        db.add_all([mentor, stranger_mentor, learner]); await db.flush()
        student = Student(full_name=f'Summary Student {suffix}', phone=suffix, degree_level=DegreeLevel.undergraduate, intake_year=2027, user_id=learner.id)
        db.add(student); await db.flush()
        db.add(MentorAssignment(student_id=student.id, mentor_id=mentor.id, role=MentorRole.portfolio))
        olympiad = Activity(title=f'Summary Olympiad {suffix}', kind='Конкурс / олимпиада', publication='published')
        internship = Activity(title=f'Summary Internship {suffix}', kind='Стажировка', publication='published')
        db.add_all([olympiad, internship]); await db.flush()
        intakes = [ActivityIntake(activity_id=a.id, label='Осень', mode='fixed', deadline=date.today() + timedelta(days=40)) for a in (olympiad, internship)]
        db.add_all(intakes)
        await db.commit()
        ids = dict(mentor=mentor.id, stranger=stranger_mentor.id, learner=learner.id)
    app = FastAPI()
    for module in (activities, learner_tasks, portfolio_workflow, roadmaps, workspace):
        app.include_router(module.router, prefix='/api/v1')

    async def database():
        async with sessions() as db: yield db

    async def actor(request: Request):
        async with sessions() as db: return await db.get(User, ids[request.headers.get('x-test-role', 'mentor')])
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = actor
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        async def call(method, path, *, role='mentor', expected=200, **kwargs):
            response = await client.request(method, '/api/v1' + path, headers={'x-test-role': role}, **kwargs)
            assert response.status_code == expected, (path, response.status_code, response.text[:1500])
            return response.json() if response.content else None
        sid = str(student.id)

        # Пустое портфолио: все типы опыта на месте, делать нечего.
        empty = await call('GET', '/activities/my/portfolio-summary', role='learner')
        assert empty['counts']['confirmed'] == 0 and empty['actions'] == []
        assert {t['key'] for t in empty['experience']} >= {'competitions', 'internships', 'research'}

        # Шаги активности без явного флага ученик закрывает сам.
        issued = await call('POST', '/activities/assignments', json={'intake_id': str(intakes[0].id), 'request_key': str(uuid.uuid4()), 'decision': 'selected',
            'recipients': [{'student_id': sid, 'steps': [{'title': 'Регистрация'}, {'title': 'Решить задачи', 'requires_review': True}]}]})
        pid = issued['results'][0]['participation_id']
        steps = await call('GET', f'/activities/participations/{pid}/tasks')
        assert [s['requires_review'] for s in steps] == [False, True]
        # Шаг roadmap-контекста без участия по-прежнему идёт на проверку.
        standalone = await call('POST', '/learner-tasks', expected=201, json={'student_id': sid, 'title': 'Самостоятельная задача'})
        assert standalone['requires_review'] is True

        await call('POST', f"/learner-tasks/{steps[0]['id']}/complete", role='learner', json={})
        await call('POST', f"/learner-tasks/{steps[1]['id']}/complete", role='learner', json={'result_text': 'Решила'})
        summary = await call('GET', f'/activities/students/{sid}/portfolio-summary')
        assert summary['counts']['active'] == 1
        assert [a['kind'] for a in summary['mentor_actions']] == ['step_waiting']
        mine = await call('GET', '/activities/my/portfolio-summary', role='learner')
        assert [a['kind'] for a in mine['actions']] == ['step_waiting'] and mine['actions'][0]['owner'] == 'mentor'

        # Подтверждённый итог закрывает тип опыта.
        await call('POST', f"/learner-tasks/{steps[1]['id']}/review", json={'action': 'approve'})
        await call('POST', f'/activities/participations/{pid}/result', role='learner', json={'text': '2 место'})
        queue = await call('GET', f'/activities/staff/participations?view=waiting&student_id={sid}')
        assert any(i['id'] == pid and i['result_review_status'] == 'pending' for i in queue['items'])
        await call('POST', f'/activities/participations/{pid}/result/review', json={'action': 'approve'})
        done = await call('GET', '/activities/my/portfolio-summary', role='learner')
        tiles = {t['key']: t for t in done['experience']}
        assert done['counts']['confirmed'] == 1 and tiles['competitions']['confirmed'] == 1 and tiles['internships']['confirmed'] == 0

        # Фокус: ментор ученика пишет, ученик и чужой ментор — нет.
        await call('PUT', f'/activities/students/{sid}/portfolio-focus', role='learner', expected=403, json={'text': 'x'})
        await call('PUT', f'/activities/students/{sid}/portfolio-focus', role='stranger', expected=404, json={'text': 'x'})
        focus = await call('PUT', f'/activities/students/{sid}/portfolio-focus', json={'text': '  Нужна стажировка  '})
        assert focus['text'] == 'Нужна стажировка' and focus['updated_by_name'] == 'Summary Mentor'
        assert (await call('GET', '/activities/my/portfolio-summary', role='learner'))['focus']['text'] == 'Нужна стажировка'
        assert await call('PUT', f'/activities/students/{sid}/portfolio-focus', json={'text': ''}) is None
        assert (await call('GET', '/activities/my/portfolio-summary', role='learner'))['focus'] is None

        # Обзор: свой ученик виден своему ментору и не виден чужому.
        rows = await call('GET', '/activities/staff/students-overview')
        row = next(r for r in rows if r['student_id'] == sid)
        assert row['counts']['confirmed'] == 1 and row['experience_confirmed'] == ['competitions'] and row['focus_set'] is False
        assert all(r['student_id'] != sid for r in await call('GET', '/activities/staff/students-overview', role='stranger'))
        await call('GET', f'/activities/students/{sid}/portfolio-summary', role='stranger', expected=404)
    await engine.dispose()
