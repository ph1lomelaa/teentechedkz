"""Money invariants and concurrent retries against a disposable PostgreSQL."""
import asyncio
import os
import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock
import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.api.v1.endpoints import finance, payments
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User, UserRole
from app.models.student import Student, DegreeLevel
from app.models.contract import Contract, PipelineStatus
from app.models.finance import PaymentScheduleItem
from app.models.payment import Payment

ENQUEUE=AsyncMock(return_value={'state':'queued'})
URL=os.getenv('FINANCE_TEST_DATABASE_URL','')
pytestmark=pytest.mark.skipif(not URL,reason='Isolated PostgreSQL required')

def test_money_integrity(monkeypatch):
    assert '/tte_finance_check_' in URL
    from app.services import notion_sync
    monkeypatch.setattr(notion_sync,'enqueue_crm_field_edits',ENQUEUE)
    asyncio.run(run())

async def run():
    engine=create_async_engine(URL)
    sessions=async_sessionmaker(engine,expire_on_commit=False,autoflush=False)
    suffix=uuid.uuid4().hex
    async with sessions() as db:
        user=User(name='Integrity finance',email=f'{suffix}@example.test',hashed_password='x',role=UserRole.finance_manager)
        db.add(user);await db.flush()
        student=Student(full_name='Integrity '+suffix,phone=suffix,degree_level=DegreeLevel.undergraduate,intake_year=2027)
        db.add(student);await db.flush()
        c=Contract(student_id=student.id,amount=1000,client_remaining_amount=800,currency='KZT',pipeline_status=PipelineStatus.active_work)
        imported=Contract(student_id=student.id,amount=500,client_remaining_amount=300,client_remaining_date=date.today(),currency='USD')
        db.add_all([c,imported]);await db.commit()
        uid,cid,iid=user.id,c.id,imported.id
    app=FastAPI();app.include_router(finance.router);app.include_router(payments.router)
    async def database():
        async with sessions() as db:yield db
    async def actor():
        async with sessions() as db:return await db.get(User,uid)
    app.dependency_overrides[get_db]=database
    app.dependency_overrides[get_current_user]=actor
    async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
        async def call(method,url,expected=200,**kwargs):
            res=await client.request(method,url,**kwargs)
            assert res.status_code==expected,(url,res.status_code,res.text[:1000])
            return res.json() if res.content else None
        body={'contract_id':str(cid),'amount':'300','due_date':str(date.today()),'operation_key':str(uuid.uuid4())}
        one,two=await asyncio.gather(*(call('POST','/finance/schedule',201,json=body) for _ in range(2)))
        assert one['id']==two['id']
        pid=one['id']
        pay={'amount':'100','paid_at':str(date.today()),'method':'bank'}
        a=await call('POST',f'/finance/schedule/{pid}/pay',201,json=pay)
        assert a['paid']=='100.00'
        await call('POST',f'/finance/schedule/{pid}/pay',409,json={**pay,'amount':'250'})
        # Отметка финансиста личная: остаток договора прежний, в Notion ничего не ушло.
        detail=await call('GET',f'/finance/contracts/{cid}')
        assert Decimal(detail['remaining'])==800
        assert not ENQUEUE.await_count
        await asyncio.gather(call('POST','/finance/notion-import'),call('POST','/finance/notion-import'))
        async with sessions() as db:
            assert (await db.execute(select(func.count()).select_from(PaymentScheduleItem).where(PaymentScheduleItem.contract_id==iid))).scalar_one()==1
            assert (await db.execute(select(func.count()).select_from(Payment).where(Payment.contract_id==cid))).scalar_one()==1
        today=await call('GET','/finance/today')
        assert any(row['currency']=='USD' for row in today['month_totals'])
    await engine.dispose()
