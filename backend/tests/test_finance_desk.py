"""Раздел «Финансы»: статусы графика, журнал правок из Notion, уведомления и сценарий на настоящей БД.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_desk.py
База готовится так же, как в CI: `python -m app.core.bootstrap_db`.
"""
import asyncio
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.endpoints import finance
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contract import Contract, PipelineStatus
from app.models.finance import FinanceChangeEvent
from app.models.notification import Notification
from app.models.notion_field_sync import FieldSyncDirection, FieldSyncStatus, NotionFieldSync
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole
from app.services import finance_desk
from app.services.finance_desk import ItemState, aging_bucket, format_value, item_state, should_record

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')
TODAY = date(2026, 11, 1)


def test_item_state_closes_only_fully_paid_rows():
    assert item_state(amount=Decimal('100'), paid=Decimal('100'), due=TODAY - timedelta(days=5), today=TODAY) is ItemState.paid
    # Частичная оплата строку не закрывает: остаток всё ещё ждём или уже просрочили.
    assert item_state(amount=Decimal('100'), paid=Decimal('40'), due=TODAY, today=TODAY) is ItemState.today
    assert item_state(amount=Decimal('100'), paid=Decimal('40'), due=TODAY - timedelta(days=1), today=TODAY) is ItemState.overdue
    assert item_state(amount=Decimal('100'), paid=Decimal('0'), due=TODAY + timedelta(days=1), today=TODAY) is ItemState.upcoming


def test_aging_buckets_match_the_old_finances_page():
    assert [aging_bucket(d) for d in (1, 30, 31, 60, 61)] == ['b30', 'b30', 'b60', 'b60', 'b61']


def test_every_money_field_and_any_status_change_is_recorded():
    assert should_record('client_remaining_date', date(2026, 11, 10), date(2026, 11, 3))
    assert should_record('client_fee', Decimal('100.00'), Decimal('200.00'))
    assert should_record('english_paid', None, Decimal('85800'))
    assert should_record('up_paid', '25000', '50000')
    assert should_record('pipeline_status', PipelineStatus.active_work, PipelineStatus.on_visa)
    # Тот же денежный смысл в разной записи — не правка.
    assert not should_record('client_fee', Decimal('100000.00'), '100000')
    assert not should_record('client_remaining', 800000, '800 000')
    # Не деньги и формулы Notion — не в журнал.
    assert not should_record('full_name', 'A', 'B')
    assert not should_record('mentor_tbp', '1', '2')


def test_values_read_like_the_interface():
    assert format_value('client_remaining', '900000') == '900 000 ₸'
    assert format_value('client_remaining_date', '2026-11-03') == '03.11.2026'
    assert format_value('pipeline_status', 'refund') == 'На возврате'
    assert format_value('client_fee', None) == 'пусто'


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_finance_flow(monkeypatch):
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    monkeypatch.setattr(finance, '_today', lambda: TODAY)

    async def fake_upload(**kwargs):
        return f"test/{kwargs['filename']}"

    monkeypatch.setattr(finance, 'minio_upload', fake_upload)
    sent = []

    async def fake_telegram(telegram_id, text):
        sent.append((telegram_id, text))

    import app.services.telegram_bot as telegram_bot
    monkeypatch.setattr(telegram_bot, 'send_notification', fake_telegram)
    # Доставка в браузер: проверяем, что после уведомлений уходит WS-событие.
    pushed = {'notes': 0, 'events': []}

    async def fake_push_note(note):
        pushed['notes'] += 1

    async def fake_push_ws(user_ids, event, data):
        pushed['events'].append((event, data))

    import app.services.notify as notify_module
    monkeypatch.setattr(notify_module, 'push_notification', fake_push_note)
    monkeypatch.setattr(notify_module, 'push_ws', fake_push_ws)
    sent.append(pushed)
    asyncio.run(run(sent))


async def run(sent):
    pushed = sent.pop()
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    suffix = uuid.uuid4().hex[:8]
    async with sessions() as db:
        # Финансисты прошлых прогонов тоже получили бы уведомления — гасим их,
        # чтобы проверять ровно своё.
        for old in (await db.execute(select(User).where(User.role == UserRole.finance_manager))).scalars():
            old.is_active = False
        users = {
            role: User(name=f'{role} {suffix}', email=f'{role}-{suffix}@example.test', hashed_password='x',
                       role=getattr(UserRole, role), is_active=True)
            for role in ('admin', 'finance_manager', 'mzk_manager', 'mentor')
        }
        users['finance_manager'].telegram_id = f'tg-{suffix}'
        db.add_all(users.values())
        await db.flush()
        student = Student(full_name=f'Айгерим Финансовая {suffix}', phone=f'+7700{suffix[:7]}',
                          degree_level=DegreeLevel.undergraduate, intake_year=2027)
        other = Student(full_name=f'Тимур Очередь {suffix}', phone=f'+7701{suffix[:7]}',
                        degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add_all([student, other])
        await db.flush()
        contract = Contract(student_id=student.id, amount=Decimal('1350000'), currency='KZT',
                            mzk_manager_id=users['mzk_manager'].id, pipeline_status=PipelineStatus.active_work)
        # Второй договор: остаток и дата есть только в Notion, графика нет —
        # кандидат на перенос в график.
        other_contract = Contract(student_id=other.id, amount=Decimal('900000'), currency='KZT',
                                  pipeline_status=PipelineStatus.active_work,
                                  client_remaining_amount=Decimal('300000'), client_remaining_date=TODAY - timedelta(days=5))
        db.add_all([contract, other_contract])
        await db.commit()
        ids = {role: u.id for role, u in users.items()}
        student_id, contract_id, other_id, other_contract_id = student.id, contract.id, other.id, other_contract.id

    app = FastAPI()
    # Весь api_router: так проверяется и настоящий порядок роутов
    # (GET /notifications перехватывает chat.py).
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def database():
        async with sessions() as db:
            yield db

    async def actor(request: Request):
        async with sessions() as db:
            return await db.get(User, ids[request.headers.get('x-test-role', 'finance_manager')])

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = actor
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        async def call(method, path, *, role='finance_manager', expected=200, **kwargs):
            response = await client.request(method, '/api/v1' + path, headers={'x-test-role': role}, **kwargs)
            assert response.status_code == expected, (path, response.status_code, response.text[:1500])
            return response.json() if response.content else None

        # ------------------------------------------------ уведомления (главное)
        async with sessions() as db:
            s = await db.get(Student, student_id)
            c = await db.get(Contract, contract_id)
            o = await db.get(Student, other_id)
            oc = await db.get(Contract, other_contract_id)
            # Один проход синка поменял у договора два поля.
            e1 = await finance_desk.record_notion_change(
                db, student=s, contract=c, field='client_remaining', old=Decimal('800000'), new=Decimal('900000'),
                source_ref=f'field-sync:{suffix}:1')
            await finance_desk.record_notion_change(
                db, student=s, contract=c, field='client_remaining_date', old=TODAY + timedelta(days=30),
                new=TODAY + timedelta(days=35), source_ref=f'field-sync:{suffix}:2')
            # Повтор упавшего прохода не плодит запись.
            again = await finance_desk.record_notion_change(
                db, student=s, contract=c, field='client_remaining', old=Decimal('800000'), new=Decimal('900000'),
                source_ref=f'field-sync:{suffix}:1')
            assert again.id == e1.id
            # Синхронизация без фактической разницы — не запись.
            assert await finance_desk.record_notion_change(
                db, student=s, contract=c, field='client_fee', old=Decimal('1350000'), new='1350000.00') is None
            # Поле, которого нет в синке полей: приходит сравнением снимка.
            snap = type('Snap', (), {'student_id': s.id, 'notion_page_id': f'page-{suffix}'})()
            snap_events = await finance_desk.record_snapshot_changes(
                db, snapshot=snap, old_row={'up_paid': 0, 'mentor_paid': 100000},
                new_row={'up_paid': 25000, 'mentor_paid': 100000},
                edited_at=datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc))
            assert [e.field for e in snap_events] == ['up_paid']
            # У второго ученика в очереди синка ещё есть правка — его уведомление ждёт.
            await finance_desk.record_notion_change(
                db, student=o, contract=oc, field='client_fee', old=Decimal('900000'), new=Decimal('950000'),
                source_ref=f'field-sync:{suffix}:3')
            now = datetime.now(timezone.utc)
            db.add(NotionFieldSync(
                dedupe_key=f'q-{suffix}', student_id=o.id, notion_page_id=f'p2-{suffix}', field_key='client_remaining',
                direction=FieldSyncDirection.notion_to_crm, status=FieldSyncStatus.pending, decision='apply',
                source_revision='r', available_at=now, created_at=now, updated_at=now))
            await db.commit()
            assert await finance_desk.flush_notifications(db) == 1, 'Telegram — одно сообщение на договор'
            assert await finance_desk.flush_notifications(db) == 0, 'Повторный проход ничего не шлёт'

            notes = (await db.execute(select(Notification).where(
                Notification.kind == 'finance_change', Notification.user_id == ids['finance_manager']))).scalars().all()
            assert len(notes) == 1, [n.title for n in notes]
            note = notes[0]
            assert note.title.startswith(f'Айгерим Финансовая {suffix}: 3 изменения'), note.title
            assert 'Остаток клиента: 800 000 ₸ → 900 000 ₸' in note.body
            assert 'УП: оплачено' in note.body and 'Дата оплаты' in note.body
            assert note.link == f'/finance/contracts/{contract_id}'
            assert not (await db.execute(select(Notification).where(
                Notification.kind == 'finance_change', Notification.user_id == ids['admin']))).scalars().all(), \
                'Админ не получает, пока есть финансист'
            assert sent and sent[0][0] == f'tg-{suffix}' and 'Остаток клиента' in sent[0][1]
            waiting = (await db.execute(select(FinanceChangeEvent).where(
                FinanceChangeEvent.student_id == other_id))).scalar_one()
            assert waiting.notified_at is None

        assert pushed['notes'] >= 1 and pushed['events'][0][0] == 'finance.changed'
        assert str(contract_id) in pushed['events'][0][1]['contract_ids']

        # ------------------------------------------------ правки в платформе
        # МЗК меняет остаток в карточке договора — бухгалтер узнаёт, сам МЗК — нет.
        await call('PATCH', f'/contracts/{other_contract_id}', role='mzk_manager',
                   json={'client_remaining_amount': '250000'})
        # МЗК вносит оплату клиента на старой странице оплат.
        await call('POST', '/payments', role='mzk_manager', json={
            'contract_id': str(other_contract_id), 'type': 'client_payment', 'status': 'paid',
            'amount': '50000', 'paid_at': TODAY.isoformat()})
        async with sessions() as db:
            platform = (await db.execute(select(FinanceChangeEvent).where(
                FinanceChangeEvent.student_id == other_id, FinanceChangeEvent.source == 'platform'))).scalars().all()
            assert sorted(e.field for e in platform) == ['client_remaining', 'payment_added']
            assert {e.actor_id for e in platform} == {ids['mzk_manager']}
            # Правка самого бухгалтера в журнал не идёт.
            fin = await db.get(User, ids['finance_manager'])
            assert await finance_desk.record_change(
                db, student=await db.get(Student, other_id), contract=await db.get(Contract, other_contract_id),
                field='client_fee', old=1, new=2, source='platform', actor=fin) is None
            # Ученик «ждёт», пока очередь синка не опустеет — уберём её.
            for q in (await db.execute(select(NotionFieldSync).where(NotionFieldSync.student_id == other_id))).scalars():
                await db.delete(q)
            await db.commit()
            await finance_desk.flush_notifications(db)
            notes = (await db.execute(select(Notification).where(
                Notification.kind == 'finance_change', Notification.title.contains(f'Тимур Очередь {suffix}')))).scalars().all()
            assert {n.user_id for n in notes} == {ids['finance_manager']}, 'Автору правки (МЗК) не шлём'
            assert any('в платформе' in n.title for n in notes)

        # ------------------------------------------------ письма
        import app.services.mailer as mailer_module
        from app.core.config import settings
        letters, fail = [], {'on': True}

        async def fake_send_mail(*, to, subject, text, html=None):
            if fail['on']:
                raise ConnectionRefusedError('smtp down')
            letters.append((to, subject, text))

        orig = (mailer_module.is_configured, mailer_module.send_mail, settings.FINANCE_EMAIL_NOTIFICATIONS)
        mailer_module.is_configured = lambda: True
        mailer_module.send_mail = fake_send_mail
        settings.FINANCE_EMAIL_NOTIFICATIONS = True
        try:
            async with sessions() as db:
                assert await finance_desk.email_pending(db) == 0, 'SMTP упал — письмо не помечено отправленным'
            fail['on'] = False
            async with sessions() as db:
                from app.models.finance_mail import FinanceMailDelivery
                from sqlalchemy import update
                await db.execute(update(FinanceMailDelivery).where(FinanceMailDelivery.status == 'pending').values(next_attempt_at=datetime.now(timezone.utc)))
                await db.commit()
                assert await finance_desk.email_pending(db) >= 2, 'Повтор на следующем проходе'
            async with sessions() as db:
                assert await finance_desk.email_pending(db) == 0, 'Без дублей'
        finally:
            mailer_module.is_configured, mailer_module.send_mail, settings.FINANCE_EMAIL_NOTIFICATIONS = orig
        ours = [l for l in letters if suffix in l[1]]
        assert ours and all(l[0] == [f'finance_manager-{suffix}@example.test'] for l in ours)
        assert any('Остаток клиента: 800\u00a0000 ₸ → 900\u00a0000 ₸' in l[2] for l in ours)
        assert any(f'/finance/contracts/{contract_id}' in l[2] for l in ours)

        # Колокольчик CRM читает data/unread_count.
        bell = await call('GET', '/notifications?limit=50')
        assert [n['link'] for n in bell['data'] if f'Айгерим Финансовая {suffix}' in n['title']] == [f'/finance/contracts/{contract_id}']
        assert bell['unread_count'] >= 1 and bell['items'] == bell['data']

        # ------------------------------------------------ права
        await call('GET', '/finance/today', role='mentor', expected=403)
        await call('GET', '/finance/today', role='mzk_manager')
        item = {'contract_id': str(contract_id), 'amount': '450000', 'label': '2 из 3'}
        await call('POST', '/finance/schedule', role='mzk_manager', expected=403, json={**item, 'due_date': TODAY.isoformat()})

        # ------------------------------------------------ график и оплаты
        base_today = await call('GET', '/finance/today')
        base_counters = await call('GET', '/finance/counters')
        late = await call('POST', '/finance/schedule', expected=201, json={**item, 'label': '1 из 3', 'due_date': (TODAY - timedelta(days=10)).isoformat()})
        today = await call('POST', '/finance/schedule', expected=201, json={**item, 'due_date': TODAY.isoformat()})
        later = await call('POST', '/finance/schedule', expected=201, json={**item, 'label': '3 из 3', 'due_date': (TODAY + timedelta(days=30)).isoformat()})
        assert late['state'] == 'overdue' and late['days_overdue'] == 10
        await call('POST', '/finance/schedule', expected=422, json={**item, 'amount': '0', 'due_date': TODAY.isoformat()})

        async with sessions() as db:
            assert await finance_desk.notify_due_today(db, TODAY) >= 1
            await db.commit()
            assert await finance_desk.notify_due_today(db, TODAY) == 0

        part = await call('POST', f"/finance/schedule/{today['id']}/pay", expected=201,
                          json={'amount': '200000', 'paid_at': TODAY.isoformat(), 'method': 'kaspi'})
        assert part['state'] == 'today' and Decimal(part['left']) == Decimal('250000')
        await call('POST', f"/finance/schedule/{today['id']}/pay", expected=400,
                   json={'amount': '1', 'paid_at': (TODAY + timedelta(days=1)).isoformat(), 'method': 'cash'})
        done = await call('POST', f"/finance/schedule/{today['id']}/pay", expected=201,
                          json={'amount': '250000', 'paid_at': TODAY.isoformat(), 'method': 'bank'})
        assert done['state'] == 'paid' and done['method'] == 'bank' and done['has_receipt'] is False

        view = await call('GET', '/finance/today')
        mine = lambda rows: [i['id'] for i in rows if i['contract_id'] == str(contract_id)]
        assert mine(view['due_today']) == [today['id']]
        assert view['overdue_count'] - base_today['overdue_count'] == 1
        assert Decimal(view['month_received']) - Decimal(base_today['month_received']) == Decimal('450000')
        # Оплата уменьшила остаток в договоре, дата — срок ближайшего неоплаченного.
        async with sessions() as db:
            c = await db.get(Contract, contract_id)
            assert c.client_remaining_amount == Decimal('900000')
            assert c.client_remaining_date == TODAY - timedelta(days=10)
        counters = await call('GET', '/finance/counters')
        assert counters['overdue'] - base_counters['overdue'] == 1
        assert counters['no_receipt'] - base_counters['no_receipt'] == 2

        assert mine(await call('GET', '/finance/expected')) == [later['id']]
        over = await call('GET', '/finance/overdue')
        assert mine(over) == [late['id']] and next(i for i in over if i['id'] == late['id'])['reminded_at'] is None
        first = await call('POST', f"/finance/schedule/{late['id']}/remind")
        again = await call('POST', f"/finance/schedule/{late['id']}/remind")
        assert first['already_sent'] is False and again['already_sent'] is True
        over = await call('GET', '/finance/overdue')
        assert next(i for i in over if i['id'] == late['id'])['reminded_at'] is not None

        pdf = {'file': ('check.pdf', b'%PDF-1.4\n%test receipt\n', 'application/pdf')}
        await call('POST', f"/finance/payments/{done['payment_id']}/receipt", role='mzk_manager', expected=403, files=pdf)
        await call('POST', f"/finance/payments/{done['payment_id']}/receipt", expected=422,
                   files={'file': ('check.txt', b'just text', 'text/plain')})
        await call('POST', f"/finance/payments/{done['payment_id']}/receipt", expected=201, files=pdf)
        got = [p for p in await call('GET', f'/finance/received?date_from={TODAY}&date_to={TODAY}')
               if p['contract_id'] == str(contract_id)]
        assert sorted(p['method'] for p in got) == ['bank', 'kaspi']
        assert {p['id']: p['has_receipt'] for p in got}[done['payment_id']] is True
        assert all(p['recorded_by'] == f'finance_manager {suffix}' and p['label'] == '2 из 3' for p in got)

        # ------------------------------------------------ договоры
        listing = await call('GET', f'/finance/contracts?q={suffix}')
        row = next(r for r in listing['items'] if r['contract_id'] == str(contract_id))
        assert Decimal(row['paid']) == Decimal('450000') and Decimal(row['remaining']) == Decimal('900000')
        assert row['next_payment']['kind'] == 'overdue' and row['next_payment']['item']['id'] == late['id']
        assert f'mzk_manager {suffix}' in listing['mzk_options']
        other_row = next(r for r in listing['items'] if r['contract_id'] == str(other_contract_id))
        assert other_row['next_payment']['kind'] == 'not_planned'
        # «Оплачено» = договор − остаток: деньги, внесённые до запуска, видны.
        # Остаток 250 000 поставил МЗК в карточке выше.
        assert Decimal(other_row['paid']) == Decimal('650000')
        assert (await call('GET', f'/finance/contracts?q={suffix}&status=refund'))['total'] == 0

        detail = await call('GET', f'/finance/contracts/{contract_id}')
        # Остаток 900 000, в графике открыто 450 000 + 450 000 — всё распределено.
        assert Decimal(detail['undistributed']) == Decimal('0')
        assert detail['source'] == 'Платформа' and len(detail['payments']) == 2

        # ------------------------------------------------ проверка
        rv = await call('GET', '/finance/review')
        ours = [c for c in rv['changes'] if c['student_id'] == str(student_id)]
        assert {c['field'] for c in ours} == {'client_remaining', 'client_remaining_date', 'up_paid'}
        assert all(c['mzk_name'] == f'mzk_manager {suffix}' and c['status'] == 'new' for c in ours)
        date_change = next(c for c in ours if c['field'] == 'client_remaining_date')
        await call('POST', f"/finance/changes/{date_change['id']}/accept", role='mzk_manager', expected=403, json={})
        moved = await call('POST', f"/finance/changes/{date_change['id']}/accept", json={'move_schedule': True})
        assert moved['moved_item_id'] == later['id']
        await call('POST', f"/finance/changes/{date_change['id']}/accept", expected=409, json={})
        remaining_change = next(c for c in ours if c['field'] == 'client_remaining')
        assert (await call('POST', f"/finance/changes/{remaining_change['id']}/accept",
                           json={'move_schedule': True}))['moved_item_id'] is None
        up = next(c for c in ours if c['field'] == 'up_paid')
        await call('POST', f"/finance/changes/{up['id']}/reject")
        detail = await call('GET', f'/finance/contracts/{contract_id}')
        assert next(i for i in detail['schedule'] if i['id'] == later['id'])['due_date'] == (TODAY + timedelta(days=35)).isoformat()
        assert {c['status'] for c in detail['changes']} == {'accepted', 'kept'}
        assert all(c['resolved_by'] == f'finance_manager {suffix}' for c in detail['changes'])

        # ------------------------------------------------ перенос дат из Notion
        preview = await call('GET', '/finance/notion-import')
        assert preview['count'] >= 1
        await call('POST', '/finance/notion-import', role='mzk_manager', expected=403)
        assert (await call('POST', '/finance/notion-import'))['created'] >= 1
        other_detail = await call('GET', f'/finance/contracts/{other_contract_id}')
        assert [(i['label'], Decimal(i['amount'])) for i in other_detail['schedule']] == [('Остаток из Notion', Decimal('250000'))]
        assert (await call('POST', '/finance/notion-import'))['created'] == 0, 'Повтор ничего не дублирует'

        # Расхождение: убрали платёж из графика — остаток больше графика.
        await call('DELETE', f"/finance/schedule/{today['id']}", expected=409)
        await call('DELETE', f"/finance/schedule/{later['id']}", expected=204)
        rv = await call('GET', '/finance/review')
        disc = [d for d in rv['discrepancies'] if d['contract_id'] == str(contract_id)]
        assert disc and Decimal(disc[0]['undistributed']) == Decimal('450000')
        mism = await call('GET', f'/finance/contracts?q={suffix}&schedule=mismatch')
        assert [r['contract_id'] for r in mism['items']] == [str(contract_id)]
        await call('PATCH', f"/finance/schedule/{late['id']}", json={'due_date': (TODAY + timedelta(days=3)).isoformat()})
        assert late['id'] not in [i['id'] for i in await call('GET', '/finance/overdue')]
    await engine.dispose()
