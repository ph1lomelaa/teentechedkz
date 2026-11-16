"""Задание 7 (план 14.11): матрица событий, склейка, «пока не было связи»,
настройки получателя, утренняя сводка, сбой почты, молчащий Notion.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_mail_matrix.py
"""
import asyncio
import os
import smtplib
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.contract import Contract, PipelineStatus
from app.models.finance import FinanceChangeEvent, PaymentScheduleItem
from app.models.finance_mail import FinanceMailDelivery
from app.models.notification import Notification
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')
ALMATY = ZoneInfo('Asia/Almaty')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_mail_matrix():
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'
    asyncio.run(run())


async def run():
    from app.services import finance_desk, finance_mail, finance_summary

    finance_desk.EMAIL_QUIET_SECONDS = 45  # другие тесты в том же процессе ставят 0
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    async with sessions() as db:
        # Только наш финансист получает письма в этом тесте.
        for old in (await db.execute(select(User).where(User.role == UserRole.finance_manager))).scalars():
            old.is_active = False
        # Матрица плана 14.11: дата и остаток — в сводку, не письмом сразу.
        fin = User(name=f'Фин {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager,
                   is_active=True, notification_email=f'buh-{s}@example.test',
                   finance_prefs={'urgent': ['offer', 'offer_cancelled', 'client_fee', 'status', 'refund'], 'summary': True})
        picky = User(name=f'Фин2 {s}', email=f'fin2-{s}@example.test', hashed_password='x', role=UserRole.finance_manager,
                     is_active=True, finance_prefs={'urgent': ['offer'], 'summary_hour': 11, 'summary': True})
        admin = User(name=f'Админ {s}', email=f'adm-{s}@example.test', hashed_password='x', role=UserRole.admin, is_active=True,
                     finance_prefs={'summary': True, 'summary_hour': 9})
        db.add_all([fin, picky, admin])
        students = [Student(full_name=f'{n} {s}', phone=f'+7702{i}{s[:6]}', degree_level=DegreeLevel.undergraduate, intake_year=2027)
                    for i, n in enumerate(('Арман Срочный', 'Дана Склейка', 'Тимур Старый'))]
        db.add_all(students)
        await db.flush()
        contracts = [Contract(student_id=st.id, amount=Decimal('1000000'), currency='KZT', pipeline_status=PipelineStatus.active_work,
                              client_remaining_amount=Decimal('500000')) for st in students]
        db.add_all(contracts)
        await db.flush()
        db.add(PaymentScheduleItem(contract_id=contracts[0].id, student_id=students[0].id, amount=Decimal('100000'),
                                   currency='KZT', due_date=datetime.now(ALMATY).date(), label='сегодня'))
        await db.commit()

    async def record(i, field, old, new, ago_seconds):
        async with sessions() as db:
            e = await finance_desk.record_change(db, student=await db.get(Student, students[i].id),
                                                 contract=await db.get(Contract, contracts[i].id),
                                                 field=field, old=old, new=new, source='notion',
                                                 source_ref=f'mx:{s}:{i}:{field}:{new}')
            e.created_at = datetime.now(timezone.utc) - timedelta(seconds=ago_seconds)
            await db.commit()

    async def deliveries(user):
        async with sessions() as db:
            return (await db.execute(select(FinanceMailDelivery).where(FinanceMailDelivery.recipient_id == user.id)
                                     .order_by(FinanceMailDelivery.created_at))).scalars().all()

    async def pump():
        async with sessions() as db:
            await finance_desk.flush_notifications(db)
        async with sessions() as db:
            await finance_mail.enqueue(db)

    # Сумма договора — срочно; дата оплаты — только в сводку.
    await record(0, 'client_fee', '900000', '1000000', 60)
    await record(0, 'client_remaining_date', '2026-12-01', '2026-12-15', 60)
    await pump()
    got = await deliveries(fin)
    assert len(got) == 1 and got[0].kind == 'change' and 'сумма договора' in got[0].subject, [d.subject for d in got]
    assert 'Дата оплаты' not in got[0].body
    assert await deliveries(picky) == [], 'У второго финансиста срочный только оффер'

    # Склейка: два срочных по клиенту только что — ждём; через минуту — одно письмо.
    await record(1, 'client_fee', '1000000', '1100000', 5)
    await record(1, 'pipeline_status', 'active_work', 'refund', 3)
    await pump()
    assert len(await deliveries(fin)) == 1, 'Пока по договору не тихо 45 секунд — письма нет'
    async with sessions() as db:
        for e in (await db.execute(select(FinanceChangeEvent).where(FinanceChangeEvent.student_id == students[1].id))).scalars():
            e.created_at -= timedelta(seconds=60)
        await db.commit()
    await pump()
    got = await deliveries(fin)
    assert len(got) == 2 and 'Возврат' in got[1].body or 'возврат' in got[1].body.lower(), got[1].body

    # Старше суток и не ушло — одно письмо «Пока не было связи».
    await record(2, 'client_fee', '1000000', '1200000', 2 * 86400)
    await pump()
    got = await deliveries(fin)
    assert got[-1].kind == 'backlog' and got[-1].subject.startswith('Пока не было связи, произошло 1'), got[-1].subject

    # Утренняя сводка: рабочий день, не раньше часа получателя, раз в день.
    monday = datetime(2026, 11, 16, 9, 30, tzinfo=ALMATY)
    # Сводка — за сутки до часа сводки: «переносим» наши изменения на утро понедельника.
    async with sessions() as db:
        for e in (await db.execute(select(FinanceChangeEvent).where(
                FinanceChangeEvent.student_id.in_([st.id for st in students])))).scalars():
            e.created_at = monday - timedelta(hours=2)
        await db.commit()
    with patch.object(finance_summary.settings, 'FINANCE_EMAIL_NOTIFICATIONS', True):
        async with sessions() as db:
            assert await finance_summary.send_morning_summary(db, monday.replace(hour=8)) == 0
            assert await finance_summary.send_morning_summary(db, datetime(2026, 11, 14, 10, tzinfo=ALMATY)) == 0, 'Суббота'
            assert await finance_summary.send_morning_summary(db, monday) == 2, 'Финансист и подписанный админ; у второго — с 11:00'
            await db.commit()
        async with sessions() as db:
            assert await finance_summary.send_morning_summary(db, monday) == 0, 'Второй раз за день — нет'
    summary = [d for d in await deliveries(fin) if d.kind == 'summary']
    assert len(summary) == 1 and summary[0].subject.startswith('Финансы на 16.11: ждём'), summary[0].subject
    assert 'Изменения за сутки' in summary[0].body and 'Открыть платежи' in summary[0].body
    assert [d.kind for d in await deliveries(admin)] == ['summary']

    # Сбой почты: письмо не принято — админ узнаёт в колокольчике.
    def boom(**_):
        raise smtplib.SMTPResponseException(550, b'no such user')
    async with sessions() as db:
        for d in (await db.execute(select(FinanceMailDelivery).where(FinanceMailDelivery.status == 'pending',
                                                                       FinanceMailDelivery.recipient_id != fin.id))).scalars():
            d.status = 'failed'  # чужие письма прошлых тестов не трогаем
        await db.commit()
    with patch.object(finance_mail.mailer, 'send_mail', side_effect=lambda **kw: boom(**kw)):
        async with sessions() as db:
            await finance_mail.dispatch(db)
    async with sessions() as db:
        bells = (await db.execute(select(Notification).where(Notification.user_id == admin.id,
                                                             Notification.kind == 'finance_mail_failed'))).scalars().all()
        assert bells and f'buh-{s}@example.test' in bells[0].title

    # Notion молчит — админ получает колокольчик раз в час.
    async def never(_db):
        return None
    with patch('app.services.notion_sync.is_configured', return_value=True), \
         patch.object(finance_summary, 'notion_fresh_at', side_effect=never):
        async with sessions() as db:
            assert await finance_summary.check_notion_stale(db) is True
            await db.commit()
        async with sessions() as db:
            await finance_summary.check_notion_stale(db)
            await db.commit()
    async with sessions() as db:
        stale = (await db.execute(select(Notification).where(Notification.user_id == admin.id,
                                                             Notification.kind == 'notion_stale'))).scalars().all()
        assert len(stale) == 1
    # Замещение: второй финансист в отпуске — его письма получает админ.
    async with sessions() as db:
        p = await db.get(User, picky.id)
        p.finance_prefs = {**(p.finance_prefs or {}), 'away_from': (date.today() - timedelta(days=1)).isoformat(),
                           'away_to': (date.today() + timedelta(days=3)).isoformat(), 'deputy_id': str(admin.id)}
        await db.commit()
    async with sessions() as db:
        got = {u.id for u in await finance_desk.finance_mail_recipients(db)}
        assert admin.id in got and picky.id not in got and fin.id in got
    _ = date
    await engine.dispose()
