"""Задание 12 (план 14.11): отчёты сходятся между собой, долг не больше
остатка, закрытие месяца.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_reports.py
"""
import asyncio
import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contract import Contract, PipelineStatus
from app.models.finance import PaymentScheduleItem
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_reports():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run())


async def run():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    today = date.today()
    first = today.replace(day=1)
    last_month = (first - timedelta(days=1)).replace(day=1)
    async with sessions() as db:
        fin = User(name=f'Фин {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager, is_active=True)
        admin = User(name=f'Адм {s}', email=f'adm-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        db.add_all([fin, admin])
        st = Student(full_name=f'Отчёт Отчётов {s}', phone=f'+7706{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add(st)
        await db.flush()
        c = Contract(student_id=st.id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('600000'))
        db.add(c)
        await db.flush()
        rows = [PaymentScheduleItem(contract_id=c.id, student_id=st.id, amount=Decimal('300000'), currency='KZT',
                                    due_date=last_month + timedelta(days=4), label='1 из 3'),
                PaymentScheduleItem(contract_id=c.id, student_id=st.id, amount=Decimal('300000'), currency='KZT',
                                    due_date=today - timedelta(days=45), label='2 из 3'),
                PaymentScheduleItem(contract_id=c.id, student_id=st.id, amount=Decimal('300000'), currency='KZT',
                                    due_date=today + timedelta(days=20), label='3 из 3')]
        db.add_all(rows)
        await db.commit()

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    who = {'user': fin}
    app.dependency_overrides[get_current_user] = lambda: who['user']

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        async def call(method, path, expected=200, **kw):
            r = await client.request(method, path, **kw)
            assert r.status_code == expected, (path, r.status_code, r.text[:600])
            return r.json() if r.content else None

        pay = await call('POST', f"finance/schedule/{rows[0].id}/pay", 201,
                         json={'amount': '300000', 'paid_at': (last_month + timedelta(days=5)).isoformat(), 'method': 'kaspi'})

        # Дебиторка = неоплаченное по графику, по срокам; долг не больше остатка строк.
        aging = await call('GET', 'finance/reports/aging')
        total_open = Decimal('600000')
        assert Decimal(aging['total']) >= total_open
        mine = await call('GET', 'finance/reports/aging', params={'by': 'kind'})
        assert all(Decimal(r['total']) == sum(Decimal(b['total']) for b in r['buckets']) for r in mine['rows'])
        assert Decimal(aging['total']) == Decimal(mine['total']), 'итог не зависит от разреза'
        detail = await call('GET', f'finance/contracts/{c.id}')
        debt = sum(Decimal(i['left']) for i in detail['schedule'] if i['state'] == 'overdue')
        assert debt <= Decimal(detail['remaining']), 'долг не больше остатка'

        # Поступления: факт в прошлом месяце, план по графику.
        inc = await call('GET', 'finance/reports/income', params={'date_from': last_month.isoformat(), 'date_to': (first + timedelta(days=40)).isoformat()})
        lm = [r for r in inc['rows'] if r['month'] == last_month.isoformat()[:7]]
        assert lm and Decimal(lm[0]['fact']) >= Decimal('300000') and Decimal(lm[0]['plan']) >= Decimal('300000')
        assert all(Decimal(r['net']) == Decimal(r['fact']) - Decimal(r['refunds']) for r in inc['rows'])
        by_method = await call('GET', 'finance/reports/income', params={'date_from': last_month.isoformat(), 'date_to': today.isoformat(), 'by': 'method'})
        assert any(r['group'] == 'Kaspi' for r in by_method['rows'])

        summary = await call('GET', 'finance/reports/summary')
        assert Decimal(summary['overdue']) >= Decimal('300000')
        assert (await call('GET', 'finance/reports/offers', params={'date_from': first.isoformat(), 'date_to': today.isoformat()}))['offers'] >= 0

        # Закрытие месяца: без чека и сверки — только «всё равно».
        month = last_month.isoformat()[:7]
        st_m = await call('GET', f'finance/reports/months/{month}')
        assert st_m['unreconciled'] >= 1 and st_m['no_receipt'] >= 1
        r = await client.post(f'finance/reports/months/{month}/close', json={})
        assert r.status_code == 409 and r.headers.get('x-error-code') == 'MONTH_NOT_READY'
        await call('POST', 'finance/reports/reconcile', json={'ids': [p['id'] for p in st_m['payments']]})
        assert (await call('GET', f'finance/reports/months/{month}'))['unreconciled'] == 0
        await call('POST', f'finance/reports/months/{first.isoformat()[:7]}/close', 409, json={'force': True})
        await call('POST', f'finance/reports/months/{month}/close', json={'force': True})
        await call('POST', f'finance/reports/months/{month}/close', 409, json={'force': True})

        # После закрытия финансист оплату месяца не меняет, админ — может (с причиной).
        await call('PATCH', f"finance/payments/{pay['payment_id']}", 409, json={'note': 'x', 'reason': 'поправить'})
        await call('POST', f"finance/payments/{pay['payment_id']}/cancel", 409, json={'reason': 'ошибка'})
        await call('POST', f'finance/contracts/{c.id}/payments', 409,
                   json={'amount': '1000', 'paid_at': (last_month + timedelta(days=10)).isoformat(), 'method': 'cash'})
        who['user'] = admin
        await call('PATCH', f"finance/payments/{pay['payment_id']}", json={'method': 'bank', 'reason': 'админ поправил способ'})
    await engine.dispose()
