"""Задание 3 (план 14.11): оплаты распределяются по графику, правятся и
отменяются с причиной, переплата — аванс, дубль спрашивается, платёж
«после оффера» получает срок при оффере, расхождение с Notion видно.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_payments.py
"""
import asyncio
import os
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from app.core.config import settings
from unittest.mock import patch
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.application import Application, SubmissionStatus
from app.models.contract import Contract, PipelineStatus
from app.models.credential import UniversityCredential
from app.models.notification import Notification
from app.models.payment import Payment, PaymentStatus
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_payments_model():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    # Срок «день оффера + N дней» включается настройкой (16.11 по умолчанию выключен).
    with patch.object(settings, 'FINANCE_OFFER_DEADLINE', True):
        asyncio.run(run())


async def run():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    async with sessions() as db:
        fin = User(name=f'Финансист {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager, is_active=True)
        mzk = User(name=f'МЗК {s}', email=f'mzk-{s}@example.test', hashed_password='x', role=UserRole.mzk_manager, is_active=True)
        db.add_all([fin, mzk])
        st = Student(full_name=f'Дана Платёжная {s}', phone=f'+7701{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add(st)
        await db.flush()
        # В Notion остаток 900 000 из 1 000 000.
        c = Contract(student_id=st.id, amount=Decimal('1000000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                     client_remaining_amount=Decimal('900000'), mzk_manager_id=mzk.id)
        db.add(c)
        await db.flush()
        app_row = Application(student_id=st.id, contract_id=c.id, country='Италия', university='PoliMi',
                              submission_status=SubmissionStatus.submitted)
        db.add(app_row)
        await db.flush()
        db.add(UniversityCredential(student_id=st.id, application_id=app_row.id, portal_name='PoliMi', login_enc='x', password_enc='x'))
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
    today = date.today()

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        async def call(method, path, expected=200, **kw):
            r = await client.request(method, path, **kw)
            assert r.status_code == expected, (path, r.status_code, r.text[:800])
            return r.json() if r.content else None

        first = await call('POST', 'finance/schedule', 201, json={'contract_id': str(c.id), 'amount': '300000', 'due_date': (today - timedelta(days=3)).isoformat(), 'label': '1 из 3'})
        second = await call('POST', 'finance/schedule', 201, json={'contract_id': str(c.id), 'amount': '300000', 'due_date': (today + timedelta(days=30)).isoformat(), 'label': '2 из 3'})
        await call('POST', 'finance/schedule', 422, json={'contract_id': str(c.id), 'amount': '300000'})
        final = await call('POST', 'finance/schedule', 201, json={'contract_id': str(c.id), 'amount': '300000', 'after_offer': True, 'label': 'после оффера'})
        assert final['due_date'] is None and final['state'] == 'after_offer'

        # Частичная оплата: строка остаётся открытой на разницу.
        r = await call('POST', f"finance/schedule/{first['id']}/pay", 201, json={'amount': '100000', 'paid_at': today.isoformat(), 'method': 'kaspi', 'payer': 'parent'})
        assert Decimal(r['left']) == Decimal('200000') and r['state'] == 'overdue'
        partial_id = r['payment_id']

        # Дубль: та же сумма и дата — спросить.
        r = await client.post(f"finance/schedule/{first['id']}/pay", json={'amount': '100000', 'paid_at': today.isoformat(), 'method': 'kaspi'})
        assert r.status_code == 409 and r.headers.get('x-error-code') == 'DUPLICATE_PAYMENT', r.text

        # Одна оплата на две строки: предпросмотр, затем без строки графика.
        pv = await call('POST', f'finance/contracts/{c.id}/payments/preview', json={'amount': '400000'})
        assert [(p['label'], Decimal(p['amount']), p['closes']) for p in pv['parts']] == [('1 из 3', Decimal('200000'), True), ('2 из 3', Decimal('200000'), False)]
        two = await call('POST', f'finance/contracts/{c.id}/payments', 201, json={'amount': '400000', 'paid_at': today.isoformat(), 'method': 'bank'})
        detail = await call('GET', f'finance/contracts/{c.id}')
        states = {i['label']: (i['state'], Decimal(i['left'])) for i in detail['schedule']}
        assert states['1 из 3'] == ('paid', Decimal('0')) and states['2 из 3'][1] == Decimal('100000')

        # Переплата: на графике осталось 100 000 + 300 000 после оффера; 450 000 → аванс 50 000.
        over = await call('POST', f'finance/contracts/{c.id}/payments', 201, json={'amount': '450000', 'paid_at': (today - timedelta(days=1)).isoformat(), 'method': 'cash'})
        assert Decimal(over['advance']) == Decimal('50000')
        detail = await call('GET', f'finance/contracts/{c.id}')
        row = next(p for p in detail['payments'] if p['id'] == over['payment_id'])
        assert Decimal(row['advance']) == Decimal('50000') and len(row['allocations']) == 2

        # Правка суммы с причиной: распределение пересчитано, аванс ушёл.
        await call('PATCH', f"finance/payments/{over['payment_id']}", 422, json={'amount': '400000'})
        await call('PATCH', f"finance/payments/{over['payment_id']}", json={'amount': '400000', 'reason': 'опечатка в сумме'})
        detail = await call('GET', f'finance/contracts/{c.id}')
        row = next(p for p in detail['payments'] if p['id'] == over['payment_id'])
        assert Decimal(row['advance']) == Decimal('0') and Decimal(row['amount']) == Decimal('400000')

        # Отмена: оплата зачёркнута, строки снова ждут денег.
        await call('POST', f"finance/payments/{two['payment_id']}/cancel", 422, json={'reason': ''})
        await call('POST', f"finance/payments/{two['payment_id']}/cancel", json={'reason': 'платёж вернулся банком'})
        await call('POST', f"finance/payments/{two['payment_id']}/cancel", 409, json={'reason': 'ещё раз'})
        await call('PATCH', f"finance/payments/{two['payment_id']}", 409, json={'amount': '1', 'reason': 'нельзя'})
        detail = await call('GET', f'finance/contracts/{c.id}')
        cancelled = next(p for p in detail['payments'] if p['id'] == two['payment_id'])
        assert cancelled['status'] == 'cancelled' and cancelled['cancel_reason'] == 'платёж вернулся банком'
        assert Decimal(detail['recorded_paid']) == Decimal('500000'), detail['recorded_paid']
        async with sessions() as db:
            assert (await db.get(Payment, uuid.UUID(two['payment_id']))).status is PaymentStatus.cancelled

        # Журнал договора: все события с деньгами одной лентой.
        what = [j['what'] for j in detail['journal']]
        for expected in ('Внесена оплата', 'Изменена сумма оплаты', 'Изменено распределение оплаты', 'Оплата отменена', 'Добавлен платёж в график'):
            assert expected in what, what

        # Платёж «после оффера» получает срок при отметке оффера.
        who['user'] = mzk
        await call('PATCH', f'applications/{app_row.id}', json={'submission_status': 'offer_received'})
        who['user'] = fin
        detail = await call('GET', f'finance/contracts/{c.id}')
        after = next(i for i in detail['schedule'] if i['id'] == final['id'])
        # Строку уже закрыла переплата выше — важен срок: дата оффера + 5 дней.
        assert after['due_date'] == (today + timedelta(days=5)).isoformat() and after['state'] == 'paid', after

        # В Notion остаток 900 000, по оплатам 1 000 000 − 500 000 = 500 000 → расхождение.
        rv = await call('GET', 'finance/review')
        mm = next(m for m in rv['notion_mismatches'] if m['contract_id'] == str(c.id))
        assert Decimal(mm['by_payments']) == Decimal('500000') and Decimal(mm['difference']) == Decimal('400000')
        assert (await call('POST', f'finance/contracts/{c.id}/remind-notion'))['already'] is False
        assert (await call('POST', f'finance/contracts/{c.id}/remind-notion'))['already'] is True
        async with sessions() as db:
            note = (await db.execute(select(Notification).where(Notification.user_id == mzk.id,
                                                                Notification.kind == 'finance_notion_remaining'))).scalar_one()
            assert 'обновите остаток в Notion' in note.title
        # «Расписать график» шаблоном: одной операцией, повтор с тем же ключом ничего не дублирует.
        key = str(uuid.uuid4())
        plan = {'operation_key': key, 'rows': [
            {'amount': '100000', 'due_date': (today + timedelta(days=60)).isoformat(), 'label': '1 из 2'},
            {'amount': '100000', 'after_offer': True, 'label': 'после оффера'}]}
        assert (await call('POST', f'finance/contracts/{c.id}/schedule/plan', 201, json=plan))['created'] == 2
        assert (await call('POST', f'finance/contracts/{c.id}/schedule/plan', 201, json=plan))['repeated'] is True
        await call('POST', f'finance/contracts/{c.id}/schedule/plan', 422, json={'rows': [{'amount': '1'}]})
        detail = await call('GET', f'finance/contracts/{c.id}')
        assert {i['label'] for i in detail['schedule']} >= {'1 из 2', 'после оффера'}
        assert [sv['service'] for sv in detail['services']] == ['Основная']

        # Номер договора (задание 11): ведёт МЗК в CRM, ищется в финансах.
        who['user'] = mzk
        r = await call('PATCH', f'contracts/{c.id}', json={'number': f'TT-{s}'})
        assert r['number'] == f'TT-{s}'
        who['user'] = fin
        assert [h['contract_id'] for h in await call('GET', 'finance/search', params={'q': f'TT-{s}'})] == [str(c.id)]
        # «Документы проверены» — отметка финансиста, в журнале договора.
        assert (await call('POST', f'finance/contracts/{c.id}/documents-checked'))['documents_checked_by'] == fin.name
        detail = await call('GET', f'finance/contracts/{c.id}')
        assert detail['documents_checked_at'] and 'Документы проверены' in [j['what'] for j in detail['journal']]
        assert detail['addenda'] == [] and detail['act_cells'] == []

        # Поиск в шапке: часть ФИО → договор; строка договора знает о расхождении.
        hits = await call('GET', 'finance/search', params={'q': f'Платёжная {s}'})
        assert [h['contract_id'] for h in hits] == [str(c.id)]
        await call('GET', 'finance/search', 422, params={'q': 'а'})
        rows = (await call('GET', 'finance/contracts', params={'status': 'all', 'q': f'Платёжная {s}'}))['items']
        assert rows[0]['by_payments'] == '500000.00' and rows[0]['waiting_offer'] is True, 'строка «после оффера» без даты из шаблона'
        # Остаток в Notion отметки не меняют.
        async with sessions() as db:
            assert (await db.get(Contract, c.id)).client_remaining_amount == Decimal('900000')
    _ = partial_id
    # Разослать накопленное, чтобы следующие тесты в той же базе считали только своё.
    from app.services import finance_desk
    async with sessions() as db:
        await finance_desk.flush_notifications(db)
    await engine.dispose()
