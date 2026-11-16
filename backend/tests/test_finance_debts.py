"""Задание 8 (план 14.11): долги — действия, ответ МЗК, обещание, эскалация.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_debts.py
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
from app.models.finance import DebtAction, PaymentScheduleItem
from app.models.notification import Notification
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_debts():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run())


async def run():
    from app.services import finance_debts

    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    today = date.today()
    async with sessions() as db:
        fin = User(name=f'Фин {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager, is_active=True)
        mzk = User(name=f'МЗК {s}', email=f'mzk-{s}@example.test', hashed_password='x', role=UserRole.mzk_manager, is_active=True)
        other = User(name=f'МЗК2 {s}', email=f'mzk2-{s}@example.test', hashed_password='x', role=UserRole.mzk_manager, is_active=True)
        admin = User(name=f'Адм {s}', email=f'adm-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        db.add_all([fin, mzk, other, admin])
        st = Student(full_name=f'Долг Должников {s}', phone=f'+7703{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
        old = Student(full_name=f'Долг Старый {s}', phone=f'+7704{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add_all([st, old])
        await db.flush()
        c = Contract(student_id=st.id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('300000'), mzk_manager_id=mzk.id)
        c2 = Contract(student_id=old.id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                      client_remaining_amount=Decimal('300000'), mzk_manager_id=mzk.id)
        db.add_all([c, c2])
        await db.flush()
        item = PaymentScheduleItem(contract_id=c.id, student_id=st.id, amount=Decimal('300000'), currency='KZT',
                                   due_date=today - timedelta(days=3), label='2 из 3')
        late = PaymentScheduleItem(contract_id=c2.id, student_id=old.id, amount=Decimal('300000'), currency='KZT',
                                   due_date=today - timedelta(days=75), label='финал')
        db.add_all([item, late])
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

        debts = await call('GET', 'finance/debts')
        row = next(i for i in debts['items'] if i['id'] == str(item.id))
        assert row['stage'] == 'до 30 дней' and row['responsible'] == 'МЗК' and row['last_action'] is None
        far = next(i for i in debts['items'] if i['id'] == str(late.id))
        assert far['stage'] == 'более 60 дней' and far['responsible'] == 'Руководитель'
        assert {x['stage'] for x in debts['stages']} >= {'до 30 дней', 'более 60 дней'}

        # Контакт без способа — нельзя; с ним — в ленте.
        await call('POST', f'finance/debts/{item.id}/actions', 422, json={'kind': 'contact'})
        await call('POST', f'finance/debts/{item.id}/actions', 201, json={'kind': 'contact', 'channel': 'call', 'with_whom': 'мама', 'result': 'перезвонить вечером'})

        # Напомнить МЗК → МЗК отвечает «обещали оплатить» → ответ виден финансисту.
        assert (await call('POST', f'finance/schedule/{item.id}/remind'))['already_sent'] is False
        assert (await call('POST', f'finance/schedule/{item.id}/remind'))['already_sent'] is True
        row = next(i for i in (await call('GET', 'finance/debts'))['items'] if i['id'] == str(item.id))
        assert row['awaiting_mzk'] is True
        who['user'] = other
        await call('POST', f'finance/debts/{item.id}/mzk-reply', 403, json={'answer': 'no_answer'})
        who['user'] = mzk
        await call('POST', f'finance/debts/{item.id}/mzk-reply', 422, json={'answer': 'promised'})
        promise_day = today + timedelta(days=6)
        await call('POST', f'finance/debts/{item.id}/mzk-reply', 201,
                   json={'answer': 'promised', 'promise_date': promise_day.isoformat(), 'promise_amount': '300000'})
        who['user'] = fin
        row = next(i for i in (await call('GET', 'finance/debts'))['items'] if i['id'] == str(item.id))
        assert row['awaiting_mzk'] is False and row['promise']['promise_date'] == promise_day.isoformat()
        assert 'обещали оплатить' in row['last_action']['text'].lower()
        detail = await call('GET', f'finance/contracts/{c.id}')
        assert [a['kind'] for a in detail['debt_actions']] == ['mzk_reply', 'reminder', 'contact']

        # Перенос срока по согласованию: новый срок и с кем согласовано.
        await call('POST', f'finance/debts/{item.id}/actions', 422, json={'kind': 'reschedule'})

    # Эскалация: обещание действует — ничего; 75 дней — руководителю; нарушенное обещание — финансисту.
    async with sessions() as db:
        await finance_debts.escalate(db, today)
        await db.commit()
    async with sessions() as db:
        async def kinds(iid):
            return [a.kind for a in (await db.execute(select(DebtAction).where(DebtAction.schedule_item_id == iid))).scalars()]
        assert 'head_alert' not in await kinds(item.id) and 'promise_broken' not in await kinds(item.id), 'обещание держит эскалацию'
        assert 'head_alert' in await kinds(late.id)
        head = (await db.execute(select(Notification).where(Notification.user_id == admin.id, Notification.kind == 'finance_debt'))).scalars().all()
        assert any('больше 60 дней' in n.title for n in head)
    async with sessions() as db:
        await finance_debts.escalate(db, promise_day + timedelta(days=1))
        await db.commit()
    async with sessions() as db:
        assert 'promise_broken' in [a.kind for a in (await db.execute(select(DebtAction).where(DebtAction.schedule_item_id == item.id))).scalars()]
        before = len((await db.execute(select(DebtAction).where(DebtAction.schedule_item_id == item.id))).scalars().all())
        await finance_debts.escalate(db, promise_day + timedelta(days=2))
        await db.commit()
        after = len((await db.execute(select(DebtAction).where(DebtAction.schedule_item_id == item.id))).scalars().all())
        assert after == before or after == before + 1, 'нарушение отмечается один раз (дальше может прийти напоминание)'
        broken = [a for a in (await db.execute(select(DebtAction).where(DebtAction.schedule_item_id == item.id))).scalars() if a.kind == 'promise_broken']
        assert len(broken) == 1
    await engine.dispose()
