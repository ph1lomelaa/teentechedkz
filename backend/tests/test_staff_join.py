"""Заявка сотрудника на /join: роль финансиста, почта для писем, одобрение.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_staff_join.py
"""
import asyncio
import os
import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.access_request import AccessRequest
from app.models.user import User, UserRole
from app.services.google_auth import GoogleIdentity

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_finance_manager_joins_with_mail_address(monkeypatch):
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    from app.api.v1.endpoints import public
    from app.core.config import settings
    from app.services import mailer, rate_limit

    async def no_limit(*args, **kwargs):
        return None

    sent = []

    async def fake_send(*, to, subject, text, html=None):
        sent.append((to, subject, text))

    monkeypatch.setattr(rate_limit, 'enforce', no_limit)
    monkeypatch.setattr(public.rate_limit, 'enforce', no_limit)
    monkeypatch.setattr(public, 'verify_google_id_token',
                        lambda token: GoogleIdentity(email=token, email_verified=True, name=None, subject=token))
    monkeypatch.setattr(mailer, 'send_mail', fake_send)
    monkeypatch.setattr(mailer, 'is_configured', lambda: True)
    monkeypatch.setattr(settings, 'JOIN_MENTOR_CODE', 'secret-code')
    asyncio.run(run(sent))


async def run(sent):
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    async with sessions() as db:
        admin = User(name=f'admin {s}', email=f'admin-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        db.add(admin)
        await db.commit()

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[get_current_user] = lambda: admin
    google = f'fin-{s}@gmail.example'
    work = f'buh-{s}@teenteched.example'
    form = {'credential': google, 'requested_role': 'finance_manager', 'full_name': 'Финансист Тестовая', 'phone': f'+7 707 {s[:3]} {s[3:5]} {s[5:7]}'}
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        # Без почты для писем финансисту нельзя.
        r = await client.post('public/join', json=form)
        assert r.status_code == 422 and 'почту' in r.json()['detail']
        # Кривой адрес — тоже 422.
        r = await client.post('public/join', json={**form, 'contact_email': 'не почта'})
        assert r.status_code == 422
        # Код ментора финансиста не пускает: заявка ждёт админа.
        r = await client.post('public/join', json={**form, 'contact_email': work.upper(), 'code': 'secret-code'})
        assert r.status_code == 200 and r.json()['status'] == 'pending', r.text

        async with sessions() as db:
            user = (await db.execute(select(User).where(User.email == google))).scalar_one()
            req = (await db.execute(select(AccessRequest).where(AccessRequest.user_id == user.id))).scalar_one()
            assert (req.requested_role, req.contact_email, user.is_active) == ('finance_manager', work, False)

        listed = await client.get('access-requests')
        assert listed.status_code == 200, listed.text
        mine = next(i for i in listed.json()['items'] if i['id'] == str(req.id))
        assert mine['contact_email'] == work and mine['requested_role'] == 'finance_manager'

        r = await client.post(f'access-requests/{req.id}/approve', json={'role': 'finance_manager'})
        assert r.status_code == 200, r.text

        async with sessions() as db:
            user = await db.get(User, user.id)
            assert (user.role, user.is_active, user.notification_email) == (UserRole.finance_manager, True, work)
        # Приветственное письмо ушло на почту для писем, а не на Google.
        assert [to for to, *_ in sent] == [[work]]

        # Письма об изменениях денег идут туда же.
        from app.services.finance_desk import finance_address
        assert finance_address(user) == work

        # Ментор с кодом по-прежнему входит сразу.
        r = await client.post('public/join', json={**form, 'credential': f'mentor-{s}@gmail.example', 'requested_role': 'mentor',
                                                     'phone': f'+7 701 {s[:3]} {s[3:5]} {s[5:7]}', 'code': 'secret-code'})
        assert r.status_code == 200 and r.json()['status'] == 'active', r.text
    await engine.dispose()
