"""Режим «только просмотр» (решение 15.11.2026): финансист ничего не вносит,
остаток — из Notion, срок — день оффера + FINANCE_AFTER_OFFER_DAYS (на проде
«Остаток клиента (дата)» одна на всех, остаток платят после оффера); без
оффера остаток «ждёт оффера», а не просрочен, в «Проверке» одна кнопка
«Просмотрено» на событие (правки денег и офферы), любая правка денег в Notion
приходит письмом сразу.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_view_only.py
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
from app.models.finance_mail import FinanceMailDelivery
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_view_only():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    with patch.object(settings, 'FINANCE_VIEW_ONLY', True), patch.object(settings, 'FINANCE_OFFER_DEADLINE', True):
        asyncio.run(run())


async def run():
    from app.services import finance_desk, finance_mail

    finance_desk.EMAIL_QUIET_SECONDS = 0
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    today = date.today()
    async with sessions() as db:
        for old in (await db.execute(select(User).where(User.role == UserRole.finance_manager))).scalars():
            old.is_active = False
        fin = User(name=f'Жанна {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager,
                   is_active=True, notification_email=f'buh-{s}@example.test')
        db.add(fin)
        students = [Student(full_name=f'{n} {s}', phone=f'+7707{i}{s[:6]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
                    for i, n in enumerate(('Просрочка Нотионова', 'Сегодня Платит', 'Оплачено Всё', 'Ждёт Оффера'))]
        db.add_all(students)
        await db.flush()
        contracts = [
            Contract(student_id=students[0].id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('300000'), client_remaining_date=today - timedelta(days=10)),
            Contract(student_id=students[1].id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('200000'), client_remaining_date=today),
            Contract(student_id=students[2].id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('0'), client_remaining_date=None),
            # Дата в Notion давно прошла, но оффера нет — это не долг.
            Contract(student_id=students[3].id, amount=Decimal('900000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('400000'), client_remaining_date=today - timedelta(days=30)),
        ]
        db.add_all(contracts)
        await db.flush()
        now = datetime.now(timezone.utc)
        # Офферы: 10 дней назад (срок +5 прошёл 5 дней назад) и 5 дней назад (срок сегодня).
        for k, days in ((0, 10), (1, 5)):
            db.add(FinanceChangeEvent(student_id=students[k].id, contract_id=contracts[k].id, field=finance_desk.OFFER_FIELD,
                                      new_value='TU Delft', source='platform', source_ref=f'offer:vo-{s}-{k}',
                                      created_at=now - timedelta(days=days), notified_at=now, emailed_at=now))
        await db.commit()

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[get_current_user] = lambda: fin

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        async def call(method, path, expected=200, **kw):
            r = await client.request(method, path, **kw)
            assert r.status_code == expected, (path, r.status_code, r.text[:600])
            return r.json() if r.content else None

        assert (await call('GET', 'finance/counters'))['view_only'] is True
        today_view = await call('GET', 'finance/today')
        overdue = {i['student_name']: i for i in today_view['overdue']}
        assert f'Просрочка Нотионова {s}' in overdue and Decimal(overdue[f'Просрочка Нотионова {s}']['left']) == Decimal('300000')
        assert overdue[f'Просрочка Нотионова {s}']['days_overdue'] == 5
        assert f'Сегодня Платит {s}' in {i['student_name'] for i in today_view['due_today']}
        assert f'Ждёт Оффера {s}' not in overdue and today_view['waiting_offer_count'] >= 1
        debts = {i['student_name'] for i in (await call('GET', 'finance/debts'))['items']}
        assert f'Просрочка Нотионова {s}' in debts and f'Оплачено Всё {s}' not in debts and f'Ждёт Оффера {s}' not in debts
        card = await call('GET', f'finance/contracts/{contracts[0].id}')
        assert card['next_payment']['kind'] == 'overdue' and card['schedule'][0]['label'] == 'Остаток после оффера'
        waiting = await call('GET', f'finance/contracts/{contracts[3].id}')
        assert waiting['schedule'][0]['due_date'] is None and waiting['next_payment']['kind'] != 'overdue'

        # Менеджер поправил остаток в Notion → письмо сразу и событие в «Проверке».
        async with sessions() as db:
            await finance_desk.record_notion_change(db, student=await db.get(Student, students[0].id),
                                                    contract=await db.get(Contract, contracts[0].id), field='client_remaining',
                                                    old='300000', new='100000', source_ref=f'vo:{s}')
            await db.commit()
        async with sessions() as db:
            await finance_desk.flush_notifications(db)
        async with sessions() as db:
            await finance_mail.enqueue(db)
        async with sessions() as db:
            mails = (await db.execute(select(FinanceMailDelivery).where(FinanceMailDelivery.recipient_id == fin.id,
                                                                         FinanceMailDelivery.student_id == students[0].id))).scalars().all()
            assert len(mails) == 1 and 'остаток' in mails[0].subject.lower(), [m.subject for m in mails]

        rv = await call('GET', 'finance/review', params={'status': 'new'})
        assert rv['view_only'] is True and rv['no_receipt'] == [] and rv['no_schedule'] == []
        change = next(c for c in rv['changes'] if c['student_name'] == f'Просрочка Нотионова {s}')
        await call('POST', f"finance/changes/{change['id']}/accept", json={})
        rv = await call('GET', 'finance/review', params={'status': 'new'})
        assert all(c['id'] != change['id'] for c in rv['changes']), '«Просмотрено» убирает событие'
        # «Просмотрено все»: отмечает переданные события разом; повтор и уже проверенные пропускаются.
        mine = [c['id'] for c in rv['changes'] if c['student_name'].endswith(s)]
        assert len(mine) >= 2, mine
        assert (await call('POST', 'finance/changes/accept-many', json={'ids': mine + [change['id']]}))['accepted'] == len(mine)
        assert (await call('POST', 'finance/changes/accept-many', json={'ids': mine}))['accepted'] == 0
        rv = await call('GET', 'finance/review', params={'status': 'new'})
        assert not [c for c in rv['changes'] if c['student_name'].endswith(s)]
        assert (await call('GET', 'finance/prefs'))['summary'] is False, 'сводка по умолчанию выключена'
    _ = datetime, timezone
    await engine.dispose()
