import asyncio
import os
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models.finance import FinanceChangeEvent
from app.models.finance_mail import FinanceMailDelivery
from app.models.contract import Contract
from app.models.student import Student, DegreeLevel
from app.models.user import User, UserRole
from app.services import finance_mail, mailer


@pytest.mark.parametrize('error, expected', [
    (ConnectionRefusedError(), 'pending'), (smtplib.SMTPConnectError(421, b'try later'), 'pending'),
    (smtplib.SMTPDataError(451, b'try later'), 'pending'), (smtplib.SMTPDataError(550, b'refused'), 'failed'),
    (smtplib.SMTPAuthenticationError(535, b'bad auth'), 'failed'),
    (smtplib.SMTPRecipientsRefused({'x@example.com': (450, b'later')}), 'pending'),
    (TimeoutError(), 'unknown'), (smtplib.SMTPServerDisconnected(), 'unknown'), (OSError(), 'unknown'),
])
def test_only_proven_nonacceptance_is_retried(error, expected):
    assert finance_mail.failure_status(error) == expected


URL = os.environ.get('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires disposable PostgreSQL')
def test_durable_claim_mixed_authors_unknown_timeout_and_restart():
    assert '/tte_finance_check_' in URL
    asyncio.run(scenario())


async def scenario():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex
    async with sessions() as db:
        user = User(name='Финансист Очередь', email=f'outbox-{suffix}@example.test', role=UserRole.finance_manager, hashed_password='x', is_active=True)
        other = User(name='МЗК Очередь', email=f'author-{suffix}@example.test', role=UserRole.mzk_manager, hashed_password='x', is_active=True)
        student = Student(full_name=f'Очередь Студент {suffix}', degree_level=DegreeLevel.undergraduate, intake_year=2027, phone=f"+7700{uuid.uuid4().int % 10000000:07d}")
        db.add_all([user, other, student]); await db.flush()
        contract = Contract(student_id=student.id, currency='KZT'); db.add(contract); await db.flush()
        for field, actor in (('client_fee', user.id), ('client_remaining', other.id)):
            db.add(FinanceChangeEvent(student_id=student.id, contract_id=contract.id, field=field,
                actor_id=actor, source='platform', old_value='100', new_value='200'))
        await db.commit()
    with patch('app.services.finance_desk.finance_recipients', return_value=[user]):
        async with sessions() as db:
            from app.services.finance_desk import notify_pending
            out = await notify_pending(db)
            ours = [n for n in out.notifications if n.user_id == user.id and n.link == f'/finance/contracts/{contract.id}']
            assert len(ours) == 1
            assert 'Остаток клиента' in ours[0].body and 'Сумма договора' not in ours[0].body
            await db.commit()
            await finance_mail.enqueue(db)
            db.add(FinanceChangeEvent(student_id=student.id, contract_id=contract.id,
                field='client_fee', actor_id=user.id, source='platform', old_value='200', new_value='300'))
            await db.commit()
            own_only = await notify_pending(db)
            assert own_only.notifications == [], 'No bell for the author'
            assert own_only.recipients == {user.id}, 'Author still receives data invalidation for other tabs'
            await db.commit()
        async with sessions() as db:
            await finance_mail.enqueue(db)
            rows = (await db.execute(select(FinanceMailDelivery).where(FinanceMailDelivery.recipient_id == user.id, FinanceMailDelivery.contract_id == contract.id))).scalars().all()
            assert len(rows) == 1
            row = rows[0]; delivery_id = row.id
            assert 'Остаток клиента' in row.body and 'Сумма договора' not in row.body
    calls = []
    async def timeout(**kwargs):
        if kwargs['to'] != [user.email] or suffix not in kwargs['subject']: return
        async with sessions() as probe:
            row = await probe.get(FinanceMailDelivery, delivery_id)
            assert row.status == 'sending' and row.attempts == 1
        calls.append(kwargs)
        raise TimeoutError('SMTP may have accepted DATA')
    with patch.object(mailer, 'send_mail', timeout):
        async with sessions() as db: await finance_mail.dispatch(db)
        async with sessions() as db: await finance_mail.dispatch(db)
    assert len(calls) == 1, 'An ambiguous timeout must never resend automatically'
    async with sessions() as db:
        row = await db.get(FinanceMailDelivery, delivery_id)
        assert row.status == 'unknown'
        row.status = 'sending'; row.claimed_at = datetime.now(timezone.utc) - timedelta(minutes=6)
        await db.commit()
    with patch.object(mailer, 'send_mail', timeout):
        async with sessions() as db: await finance_mail.dispatch(db)
    async with sessions() as db:
        row = await db.get(FinanceMailDelivery, delivery_id)
        assert row.status == 'unknown' and len(calls) == 1
    # SMTP accepted, then the final DB commit fails: the durable claim must
    # survive so another worker cannot send the same summary again.
    async with sessions() as db:
        row = await db.get(FinanceMailDelivery, delivery_id)
        row.status = 'pending'; row.next_attempt_at = datetime.now(timezone.utc)
        await db.commit()
    accepted = []
    async def accept(**kwargs):
        if kwargs['to'] == [user.email] and suffix in kwargs['subject']:
            accepted.append(kwargs)
    async with sessions() as db:
        real_commit = db.commit
        commits = [0]
        async def failing_commit():
            commits[0] += 1
            if commits[0] == 3:
                raise RuntimeError('database unavailable after SMTP acceptance')
            await real_commit()
        with patch.object(mailer, 'send_mail', accept), patch.object(db, 'commit', failing_commit):
            with pytest.raises(RuntimeError):
                await finance_mail.dispatch(db)
    assert len(accepted) == 1
    with patch.object(mailer, 'send_mail', accept):
        async with sessions() as db:
            assert (await db.get(FinanceMailDelivery, delivery_id)).status == 'sending'
            await finance_mail.dispatch(db)
    assert len(accepted) == 1
    await engine.dispose()
