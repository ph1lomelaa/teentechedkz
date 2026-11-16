"""Задание 9 (план 14.11): возврат — запрос, согласование с суммой, выплата.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_refunds.py
"""
import asyncio
import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contract import Contract, PipelineStatus
from app.models.finance import FinanceChangeEvent, PaymentScheduleItem
from app.models.refund_case import RefundCase, RefundLevel
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_refunds():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run())


async def run():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    today = date.today()
    async with sessions() as db:
        fin = User(name=f'Фин {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager, is_active=True)
        mzk = User(name=f'МЗК {s}', email=f'mzk-{s}@example.test', hashed_password='x', role=UserRole.mzk_manager, is_active=True)
        admin = User(name=f'Адм {s}', email=f'adm-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        db.add_all([fin, mzk, admin])
        st = Student(full_name=f'Возврат Клиентов {s}', phone=f'+7705{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add(st)
        await db.flush()
        c = Contract(student_id=st.id, amount=Decimal('1000000'), currency='KZT', pipeline_status=PipelineStatus.refund,
                     client_remaining_amount=Decimal('500000'), mzk_manager_id=mzk.id)
        db.add(c)
        await db.flush()
        open_row = PaymentScheduleItem(contract_id=c.id, student_id=st.id, amount=Decimal('500000'), currency='KZT',
                                       due_date=today + timedelta(days=20), label='2 из 2')
        db.add_all([PaymentScheduleItem(contract_id=c.id, student_id=st.id, amount=Decimal('500000'), currency='KZT',
                                        due_date=today - timedelta(days=40), label='1 из 2'), open_row])
        await db.commit()

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    who = {'user': mzk}
    app.dependency_overrides[get_current_user] = lambda: who['user']

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        async def call(method, path, expected=200, **kw):
            r = await client.request(method, path, **kw)
            assert r.status_code == expected, (path, r.status_code, r.text[:600])
            return r.json() if r.content else None

        # МЗК: оплата 500 000 до возврата и запрос на возврат 400 000.
        who['user'] = fin
        await call('POST', f'finance/contracts/{c.id}/payments', 201, json={'amount': '500000', 'paid_at': (today - timedelta(days=30)).isoformat(), 'method': 'bank'})
        who['user'] = mzk
        case = await call('POST', 'refund-cases', json={'contract_id': str(c.id), 'student_id': str(st.id), 'amount': 400000, 'reason': 'Передумали'})
        async with sessions() as db:
            assert (await db.execute(select(FinanceChangeEvent).where(FinanceChangeEvent.source_ref == f"refund_requested:{case['id']}"))).scalar_one()
            rc = await db.get(RefundCase, uuid.UUID(case['id']))
            rc.level = RefundLevel.simple if hasattr(RefundLevel, 'simple') else list(RefundLevel)[0]
            await db.commit()

        rows = (await call('GET', 'finance/refunds'))['items']
        row = next(r for r in rows if r['id'] == case['id'])
        assert row['stage'] == 'Запрошен' and Decimal(row['contract_paid']) == Decimal('500000')

        # Выплатить до согласования нельзя.
        who['user'] = fin
        await call('POST', f"finance/refunds/{case['id']}/payout", 409, json={'amount': '350000', 'paid_at': today.isoformat(), 'method': 'bank'})

        # Руководитель согласует 350 000 вместо 400 000.
        who['user'] = admin
        await call('PATCH', f"refund-cases/{case['id']}/approve", json={'decision': 'Вернуть часть', 'approval_note': 'Согласовано письмом', 'approved_amount': '350000'})
        row = next(r for r in (await call('GET', 'finance/refunds'))['items'] if r['id'] == case['id'])
        assert row['stage'] == 'Согласован' and Decimal(row['approved']) == Decimal('350000')

        # Финансист выплачивает: строки графика отменены, «по оплатам» уменьшилось.
        who['user'] = fin
        r = await call('POST', f"finance/refunds/{case['id']}/payout", 201, json={'amount': '350000', 'paid_at': today.isoformat(), 'method': 'bank'})
        assert r['cancelled_items'] == 1
        await call('POST', f"finance/refunds/{case['id']}/payout", 409, json={'amount': '1', 'paid_at': today.isoformat(), 'method': 'bank'})
        row = next(r for r in (await call('GET', 'finance/refunds'))['items'] if r['id'] == case['id'])
        assert row['stage'] == 'Выплачен' and Decimal(row['paid_amount']) == Decimal('350000')
        detail = await call('GET', f'finance/contracts/{c.id}')
        assert Decimal(detail['recorded_paid']) == Decimal('150000')
        assert next(i for i in detail['schedule'] if i['id'] == str(open_row.id))['state'] == 'cancelled'
        assert 'Выплачен возврат клиенту' in [j['what'] for j in detail['journal']]
    await engine.dispose()
