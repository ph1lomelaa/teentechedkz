"""Конструктор активности на настоящей БД: создание одним запросом, шаблон, копия, новый сезон, дубли.

PORTFOLIO_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_portfolio_check_... pytest ...
"""
import asyncio
import os
import uuid
from datetime import date

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.endpoints import activities, activity_compose
from app.api.v1.endpoints.activity_compose import _next_year
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole

URL = os.getenv('PORTFOLIO_TEST_DATABASE_URL', '')


def test_next_year_handles_leap_day():
    assert _next_year(date(2028, 2, 29)) == date(2029, 2, 28)
    assert _next_year(date(2030, 10, 1)) == date(2031, 10, 1)


@pytest.mark.skipif(not URL, reason='Requires an isolated Portfolio UP test database')
def test_activity_composer(monkeypatch):
    assert '/tte_portfolio_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run())


async def run():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:8]
    async with sessions() as db:
        mentor = User(name='Composer Mentor', email=f'c-mentor-{suffix}@example.test', hashed_password='x', role=UserRole.mentor)
        learner = User(name='Composer Student', email=f'c-student-{suffix}@example.test', hashed_password='x', role=UserRole.student)
        db.add_all([mentor, learner]); await db.commit()
        ids = dict(mentor=mentor.id, learner=learner.id)
    app = FastAPI()
    for module in (activities, activity_compose):
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
        title = f'Олимпиада конструктора {suffix}'
        steps = [{'title': 'Регистрация', 'days_before_deadline': 30, 'requires_evidence': True}, {'title': ' Эссе ', 'requires_review': True, 'subtasks': ['План', ' ']}]
        body = {'activity': {'title': title, 'kind': 'Курс', 'experience_type': 'competitions', 'source_url': f'https://example.org/{suffix}/'},
                'intake': {'label': 'Осень 2030', 'mode': 'fixed', 'deadline': '2030-11-01', 'cost_state': 'paid', 'cost_text': '10 USD'}, 'steps': steps}
        await call('POST', '/activities/full', role='learner', expected=403, json=body)
        await call('POST', '/activities/full', expected=422, json={**body, 'steps': [{'title': '   '}]})
        created = await call('POST', '/activities/full', expected=201, json=body)
        # Явный тип важнее угаданного по kind («Курс»).
        assert created['experience_type'] == 'competitions' and created['experience_explicit'] is True
        aid = created['id']
        template = await call('GET', f'/activities/{aid}/step-template')
        assert [s['title'] for s in template] == ['Регистрация', 'Эссе'] and template[1]['subtasks'] == ['План']
        intake = (await call('GET', f'/activities/{aid}/intakes'))[0]
        assert intake['deadline'] == '2030-11-01'

        # Шаблон заменяется целиком.
        await call('PUT', f'/activities/{aid}/step-template', json={'steps': [{'title': 'Только один'}]})
        assert [s['title'] for s in await call('GET', f'/activities/{aid}/step-template')] == ['Только один']

        # Новый сезон: год в названии и дедлайн +1, платная цена снова «уточняется».
        season = await call('POST', f"/activities/{aid}/intakes/{intake['id']}/next-season", expected=201)
        assert season['label'] == 'Осень 2031' and season['deadline'] == '2031-11-01' and season['cost_state'] == 'unknown'

        # Копия: черновик с шаблоном, без наборов.
        copy = await call('POST', f'/activities/{aid}/duplicate', expected=201)
        assert copy['publication'] == 'draft' and copy['title'].endswith('(копия)') and copy['experience_type'] == 'competitions'
        assert [s['title'] for s in await call('GET', f"/activities/{copy['id']}/step-template")] == ['Только один']
        assert await call('GET', f"/activities/{copy['id']}/intakes") == []

        # Дубли: по названию без регистра и по сайту без схемы и слеша.
        found = await call('GET', '/activities/staff/duplicates', params={'title': title.upper()})
        assert any(d['id'] == aid and d['reason'] == 'title' for d in found)
        by_url = await call('GET', '/activities/staff/duplicates', params={'title': 'нечто', 'source_url': f'http://www.example.org/{suffix}'})
        assert {d['id'] for d in by_url} == {aid, copy['id']}
        assert all(d['id'] != aid for d in await call('GET', '/activities/staff/duplicates', params={'title': title, 'exclude': aid}))
    await engine.dispose()
