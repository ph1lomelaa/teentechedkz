"""Actual PostgreSQL/API checks for financial document ownership and role access."""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.api.v1.endpoints import acts, finance, trustme
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contract import Contract, PipelineStatus
from app.models.student import Student, DegreeLevel
from app.models.user import User, UserRole
from app.models.service_act import ServiceAct
from app.models.trustme_contract import TrustMeContractLink

URL = os.environ.get('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires disposable PostgreSQL')
def test_documents_belong_to_exact_contract_and_finance_is_read_only():
    assert '/tte_finance_check_' in URL
    asyncio.run(scenario())


async def scenario():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex
    async with sessions() as db:
        admin = User(name='Документы Админ', email=f'docs-admin-{suffix}@example.test', role=UserRole.admin, hashed_password='x', is_active=True)
        viewer = User(name='Документы Финансы', email=f'docs-fin-{suffix}@example.test', role=UserRole.finance_manager, hashed_password='x', is_active=True)
        student = Student(full_name=f'Документы Студент {suffix}', degree_level=DegreeLevel.undergraduate, intake_year=2027, phone=f"+7700{uuid.uuid4().int % 10000000:07d}")
        other = Student(full_name=f'Другой Студент {suffix}', degree_level=DegreeLevel.undergraduate, intake_year=2027, phone=f"+7700{uuid.uuid4().int % 10000000:07d}")
        db.add_all([admin, viewer, student, other]); await db.flush()
        contracts = [Contract(student_id=sid, amount=Decimal('100'), currency='KZT', pipeline_status=PipelineStatus.active_work) for sid in (student.id, student.id, other.id)]
        db.add_all(contracts); await db.flush()
        links = [TrustMeContractLink(student_id=student.id, company_id='test', external_id=f'{suffix}-{i}', short_url=f'testLink{i}', name=f'Договор {i}', status=3, signers=[]) for i in range(2)]
        db.add_all(links); await db.commit()
    current = [admin]
    app = FastAPI()
    app.include_router(finance.router); app.include_router(trustme.router); app.include_router(acts.router)
    async def database():
        async with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: current[0]
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        sid, c1, c2, c3 = student.id, *[c.id for c in contracts]
        base = f'/trustme/students/{sid}/links/{links[0].id}'
        response = await client.patch(base + '/financial-contract', json={'financial_contract_id': str(c3)})
        assert response.status_code == 422
        response = await client.patch(base + '/financial-contract', json={'financial_contract_id': str(c1)})
        assert response.status_code == 200, response.text
        async with sessions() as db:
            act = ServiceAct(student_id=sid, contract_link_id=links[0].id, created_by=admin.id, status='ready', snapshot={
                'student_name': student.full_name, 'template': 'ielts', 'act_date': '2026-11-01', 'contract_link_id': str(links[0].id)},
                file_name='test.pdf', storage_path='test.pdf', generated_at=datetime.now(timezone.utc))
            db.add(act); await db.commit()
        # Moving or deleting a link would misattribute the generated document.
        assert (await client.patch(base + '/financial-contract', json={'financial_contract_id': str(c2)})).status_code == 409
        assert (await client.delete(base)).status_code == 409
        current[0] = viewer
        data = (await client.get(f'/finance/contracts/{c1}/documents')).json()
        assert [c['id'] for c in data['contracts']] == [str(links[0].id)]
        assert [a['id'] for a in data['acts']] == [str(act.id)]
        assert [c['id'] for c in data['unassigned_contracts']] == [str(links[1].id)]
        second = (await client.get(f'/finance/contracts/{c2}/documents')).json()
        assert second['contracts'] == [] and second['acts'] == []
        assert (await client.patch(base + '/financial-contract', json={'financial_contract_id': str(c2)})).status_code == 403
        assert (await client.post(f'/acts/{act.id}/generate')).status_code == 403
        assert (await client.post(f'/acts/{act.id}/send', json={'request_id': str(uuid.uuid4()), 'recipient': 'test@example.com', 'subject': 'Test', 'body': 'Test'})).status_code == 403
        class Client:
            company_id = 'test'
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def pdf(self, short): return b'%PDF-test'
        with patch.object(acts, '_client', return_value=Client()):
            assert (await client.get(f'/acts/students/{sid}/contracts/{links[0].id}/pdf')).content == b'%PDF-test'
        with patch.object(acts, 'minio_download', AsyncMock(return_value=b'%PDF-saved')):
            assert (await client.get(f'/acts/{act.id}/pdf')).content == b'%PDF-saved'
        listing = (await client.get('/finance/contracts', params={'q': suffix, 'status': 'all'})).json()
        first = next(r for r in listing['items'] if r['contract_id'] == str(c1))
        assert first['trustme_count'] == 1 and first['acts_count'] == 1
        for filter_name in ('no_contract', 'no_act'):
            rows = (await client.get('/finance/contracts', params={'q': suffix, 'status': 'all', 'documents': filter_name})).json()['items']
            assert str(c1) not in [r['contract_id'] for r in rows]
            assert str(c2) in [r['contract_id'] for r in rows]
    await engine.dispose()
