"""Оффер без срока (решение 16.11.2026, FINANCE_OFFER_DEADLINE=false по умолчанию):
отметка оффера только отмечает оффер. Срока оплаты и просрочки после оффера нет,
ученик уходит из «Ждут оффера», в «Следующем платеже» — «Оффер получен»,
в письме и колокольчике — «оплачивается после оффера» без даты.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_offer_no_deadline.py
"""
import asyncio
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contract import Contract, PipelineStatus
from app.models.finance import FinanceChangeEvent
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_offer_without_deadline():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    with patch.object(settings, 'FINANCE_VIEW_ONLY', True), patch.object(settings, 'FINANCE_OFFER_DEADLINE', False):
        asyncio.run(run())


async def run():
    from app.services import finance_desk

    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    async with sessions() as db:
        admin = User(name=f'Админ {s}', email=f'adm-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        db.add(admin)
        st = [Student(full_name=f'{n} {s}', phone=f'+7708{i}{s[:6]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
              for i, n in enumerate(('Давний Оффер', 'Без Оффера'))]
        db.add_all(st)
        await db.flush()
        c = [Contract(student_id=x.id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                      client_remaining_amount=Decimal('300000'), client_remaining_date=date.today() - timedelta(days=40))
             for x in st]
        db.add_all(c)
        await db.flush()
        # Оффер 20 дней назад: при сроке «+5 дней» это была бы просрочка.
        db.add(FinanceChangeEvent(student_id=st[0].id, contract_id=c[0].id, field=finance_desk.OFFER_FIELD,
                                  new_value='TU Delft', source='platform', source_ref=f'offer:nd-{s}',
                                  created_at=now - timedelta(days=20), notified_at=now, emailed_at=now))
        await db.commit()

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[get_current_user] = lambda: admin

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        async def call(path, **kw):
            r = await client.get(path, **kw)
            assert r.status_code == 200, (path, r.status_code, r.text[:400])
            return r.json()

        counters = await call('finance/counters')
        assert counters['offer_deadline'] is False
        today = await call('finance/today')
        assert f'Давний Оффер {s}' not in {i['student_name'] for i in today['overdue']}, 'без срока просрочки нет'
        card = await call(f'finance/contracts/{c[0].id}')
        assert card['next_payment']['kind'] == 'offer_received', card['next_payment']
        assert card['schedule'][0]['due_date'] is None
        waiting = await call(f'finance/contracts/{c[1].id}')
        assert waiting['next_payment']['kind'] == 'after_offer'
        rows = {r['student_name']: r for r in (await call('finance/contracts', params={'status': 'all', 'size': 2000}))['items']}
        assert not rows[f'Давний Оффер {s}']['waiting_offer'] and rows[f'Без Оффера {s}']['waiting_offer']
        student = await call(f'students/{st[0].id}')
        kinds = {a['kind'] for a in student.get('alerts', [])}
        assert 'payment_offer_received' in kinds and 'payment_overdue' not in kinds, kinds

    # Письмо финансисту: «оплачивается после оффера», без даты.
    async with sessions() as db:
        event = (await db.execute(select(FinanceChangeEvent).where(FinanceChangeEvent.source_ref == f'offer:nd-{s}'))).scalar_one()
        group = finance_desk.ChangeGroup(student_id=st[0].id, contract_id=c[0].id, student_name=f'Давний Оффер {s}',
                                         events=[event], actors={}, remaining=Decimal('300000'))
        steps = finance_desk.next_steps(group)
        assert any('оплачивается после оффера' in x for x in steps) and not any('срок до' in x for x in steps), steps
    await engine.dispose()
