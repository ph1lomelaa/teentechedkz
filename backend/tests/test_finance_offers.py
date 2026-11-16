"""Оффер в заявке ученика → финансист узнаёт, что пора закрыть остаток.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_offers.py
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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.application import Application, SubmissionStatus
from app.models.contract import Contract, PipelineStatus
from app.models.credential import UniversityCredential
from app.models.notification import Notification
from app.models.finance import FinanceChangeEvent
from app.models.finance_mail import FinanceMailDelivery
from app.models.payment import Payment, PaymentStatus, PaymentType
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_offer_tells_finance_to_close_remaining():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    # Срок «день оффера + N дней» включается настройкой (16.11 по умолчанию выключен).
    with patch.object(settings, 'FINANCE_OFFER_DEADLINE', True):
        asyncio.run(run())


async def run():
    from app.services import finance_desk
    finance_desk.EMAIL_QUIET_SECONDS = 0  # склейку проверяет test_finance_mail_matrix
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    async with sessions() as db:
        admin = User(name=f'Менеджер {s}', email=f'mzk-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True)
        finance = User(name=f'Финансист {s}', email=f'fin-{s}@example.test', hashed_password='x',
                       role=UserRole.finance_manager, is_active=True, notification_email=f'buh-{s}@example.test')
        mzk = User(name=f'МЗК {s}', email=f'mzk2-{s}@example.test', hashed_password='x', role=UserRole.mzk_manager, is_active=True)
        head = User(name=f'Академ {s}', email=f'head-{s}@example.test', hashed_password='x', role=UserRole.academic_head, is_active=True)
        db.add_all([admin, finance, mzk, head])
        students = [Student(full_name=f'{name} {s}', phone=f'+77{i}{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
                    for i, name in enumerate(('Айгерим Офферная', 'Тимур Бездоступный', 'Дана Оплаченная'))]
        db.add_all(students)
        await db.flush()
        owes, no_access, paid = students
        contracts = [Contract(student_id=st.id, amount=Decimal('1000000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                              client_remaining_amount=Decimal(rest))
                     for st, rest in ((owes, '300000'), (no_access, '500000'), (paid, '0'))]
        contracts[0].mzk_manager_id = mzk.id
        db.add_all(contracts)
        await db.flush()
        apps = [Application(student_id=st.id, contract_id=c.id, country='Нидерланды', university='TU Delft',
                            submission_status=SubmissionStatus.submitted)
                for st, c in zip(students, contracts)]
        second = Application(student_id=owes.id, contract_id=contracts[0].id, country='Германия', university='TU München',
                             submission_status=SubmissionStatus.submitted)
        db.add_all([*apps, second])
        await db.flush()
        db.add_all([UniversityCredential(student_id=a.student_id, application_id=a.id, portal_name='Studielink',
                                         login_enc='x', password_enc='x') for a in (apps[0], apps[2], second)])
        # Финансист отметила 800 000, а в Notion остаток так и остался 300 000.
        db.add(Payment(contract_id=contracts[0].id, type=PaymentType.client_payment, amount=Decimal('800000'),
                       status=PaymentStatus.paid, recorded_by=admin.id))
        await db.commit()

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[get_current_user] = lambda: admin

    async def events(student_id, field):
        async with sessions() as db:
            return (await db.execute(select(func.count()).select_from(FinanceChangeEvent).where(
                FinanceChangeEvent.student_id == student_id, FinanceChangeEvent.field == field))).scalar_one()

    from app.services import finance_desk, finance_mail

    async def mails(student_id):
        """Колокольчик и письма по накопленным событиям; письма ученика по порядку."""
        async with sessions() as db:
            await finance_desk.flush_notifications(db)
        async with sessions() as db:
            await finance_mail.enqueue(db)
        async with sessions() as db:
            return (await db.execute(select(FinanceMailDelivery).where(
                FinanceMailDelivery.student_id == student_id, FinanceMailDelivery.recipient_id == finance.id)
                .order_by(FinanceMailDelivery.created_at))).scalars().all()

    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        r = await client.patch(f'applications/{apps[0].id}', json={'submission_status': 'offer_received'})
        assert r.status_code == 200, r.text
        assert await events(owes.id, 'offer_received') == 1

        # Колокольчик об оффере МЗК договора и академ-хеду (15.11), не тому, кто отметил.
        async with sessions() as db:
            bells = (await db.execute(select(Notification.user_id).where(
                Notification.kind == 'offer_received', Notification.link == f'/students/{owes.id}'))).scalars().all()
        assert mzk.id in bells and head.id in bells and admin.id not in bells, bells

        # Блок «Оффер» в карточке: вуз, кто отметил, остаток и срок после оффера.
        r = await client.get(f'students/{owes.id}/offers')
        assert r.status_code == 200, r.text
        block = r.json()
        assert [i['university'] for i in block['items']] == ['TU Delft'] and block['items'][0]['status'] == 'offer_received'
        assert block['items'][0]['marked_by'].startswith(f'Менеджер {s}') and block['items'][0]['marked_at']
        assert Decimal(block['remaining']) == Decimal('300000') and block['due_date'], block

        # Письмо: на почту для писем, остаток в теме, кто отметил с ролью,
        # одно изменение строкой (не списком), без длинного тире.
        got = await mails(owes.id)
        assert len(got) == 1
        mail = got[0]
        assert mail.recipient == f'buh-{s}@example.test'
        assert 'оффер получен, остаток 300' in mail.subject, mail.subject
        assert 'TU Delft' in mail.body and 'оплачивается после оффера, срок до' in mail.body, mail.body
        assert f'Отметил: Менеджер {s}, админ' in mail.body, mail.body
        assert '•' not in mail.body and '<ul' not in mail.html
        assert '—' not in mail.subject and '—' not in mail.body, mail.body
        # В Notion остаток 300 000, а по оплатам 1 000 000 − 800 000 = 200 000.
        assert 'В Notion остаток 300\u00a0000 ₸, по оплатам 200\u00a0000 ₸' in mail.body, mail.body

        # Сняли оффер — «Оффер отменён» письмом; ученик уходит из списка.
        r = await client.patch(f'applications/{apps[0].id}', json={'submission_status': 'submitted'})
        assert r.status_code == 200, r.text
        assert await events(owes.id, 'offer_cancelled') == 1
        got = await mails(owes.id)
        assert len(got) == 2 and 'оффер отменён' in got[1].subject, got[1].subject
        r = await client.get('finance/offers-due')
        assert str(owes.id) not in {i['student_id'] for i in r.json()['items']}

        # Поставили снова — снова «Оффер получен».
        r = await client.patch(f'applications/{apps[0].id}', json={'submission_status': 'offer_received'})
        assert r.status_code == 200, r.text
        assert await events(owes.id, 'offer_received') == 2
        assert len(await mails(owes.id)) == 3

        # Второй оффер того же ученика — строка в истории, без письма.
        r = await client.patch(f'applications/{second.id}', json={'submission_status': 'offer_received'})
        assert r.status_code == 200, r.text
        assert await events(owes.id, 'offer_received') == 3
        assert len(await mails(owes.id)) == 3
        # Удалили вторую заявку — отмена тоже без письма: первый оффер остаётся.
        r = await client.delete(f'applications/{second.id}')
        assert r.status_code == 200, r.text
        assert await events(owes.id, 'offer_cancelled') == 2
        assert len(await mails(owes.id)) == 3

        # Без доступов к порталу оффер не ставится, и финансист ничего не получает.
        r = await client.patch(f'applications/{apps[1].id}', json={'submission_status': 'offer_received'})
        assert r.status_code == 422
        assert r.json()['detail'] == 'Чтобы отметить оффер, добавьте доступ к порталу вуза: название портала, логин, пароль.'
        assert await events(no_access.id, 'offer_received') == 0

        # Оффер у оплаченного договора: событие есть, но в списке «закрыть остаток» его нет.
        r = await client.patch(f'applications/{apps[2].id}', json={'submission_status': 'enrolled'})
        assert r.status_code == 200, r.text

        r = await client.get('finance/offers-due')
        assert r.status_code == 200, r.text
        listed = {i['student_id']: i for i in r.json()['items']}
        assert str(owes.id) in listed and str(paid.id) not in listed and str(no_access.id) not in listed
        row = listed[str(owes.id)]
        assert Decimal(row['remaining']) == Decimal('300000') and Decimal(row['paid']) == Decimal('700000')
        assert Decimal(row['by_payments']) == Decimal('200000')
        assert row['university'] == 'TU Delft, Нидерланды' and row['offer_at'] and row['issued_at'] is None
        # Дата оффера по Алматы: фронт режет строку до 10 символов.
        assert row['offer_at'].endswith('+05:00')

        # «Выставить»: остатка нет в графике — появляется строка «Остаток после оффера»
        # на 300 000 со сроком через 5 дней, оффер отмечен как выставленный.
        waiting = (await client.get('finance/counters')).json()['offers_waiting']
        r = await client.post(f"finance/offers/{row['contract_id']}/issue")
        assert r.status_code == 200, r.text
        assert r.json()['created_item'] and r.json()['due_date'] == (date.today() + timedelta(days=5)).isoformat()
        assert (await client.get('finance/counters')).json()['offers_waiting'] == waiting - 1
        detail = (await client.get(f"finance/contracts/{row['contract_id']}")).json()
        after = next(i for i in detail['schedule'] if i['label'] == 'Остаток после оффера')
        assert Decimal(after['amount']) == Decimal('300000') and after['after_offer'] is True
        listed = {i['student_id']: i for i in (await client.get('finance/offers-due')).json()['items']}
        assert listed[str(owes.id)]['issued_at'] and listed[str(owes.id)]['issued_by'] == f'Менеджер {s}'
        assert 'Остаток после оффера выставлен, срок' in [j['what'] for j in detail['journal']]

    done = await mails(paid.id)
    assert len(done) == 1 and 'остаток 0' in done[0].subject and 'оплачен полностью' in done[0].body, done[0].body
    await engine.dispose()
