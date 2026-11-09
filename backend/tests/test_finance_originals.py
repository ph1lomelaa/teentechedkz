"""«Документ договора» у финансиста: какой файл считается настоящим договором
и что роут скана отдаёт только скан этого же ученика.

FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://.../tte_finance_check_... pytest tests/test_finance_originals.py
"""
import asyncio
import os
import uuid
from decimal import Decimal

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api.v1.endpoints import finance
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.contract import Contract, PipelineStatus
from app.models.document import DocType, Document
from app.models.student import DegreeLevel, Student
from app.models.trustme_contract import TrustMeContractLink
from app.models.user import User, UserRole

URL = os.getenv('FINANCE_TEST_DATABASE_URL', '')


@pytest.mark.skipif(not URL, reason='Requires an isolated finance test database')
def test_original_contract_documents(monkeypatch):
    assert '/tte_finance_check_' in URL, 'Refusing to run against a non-disposable database'

    async def fake_download(path):
        return b'%PDF-' + path.encode()

    import app.services.minio_service as minio_service
    monkeypatch.setattr(minio_service, 'minio_download', fake_download)
    asyncio.run(run())


async def run():
    engine = create_async_engine(URL)
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    s = uuid.uuid4().hex[:8]
    async with sessions() as db:
        fin = User(name=f'fin {s}', email=f'fin-{s}@example.test', hashed_password='x', role=UserRole.finance_manager, is_active=True)
        db.add(fin)
        await db.flush()
        students = [Student(full_name=f'{n} {s}', phone=f'+77{i}0{s[:7]}', degree_level=DegreeLevel.undergraduate, intake_year=2026)
                    for i, n in enumerate(['Привязан', 'Свободный', 'Скан', 'Пусто'])]
        db.add_all(students)
        await db.flush()
        contracts = [Contract(student_id=st.id, amount=Decimal('1000000'), currency='KZT', pipeline_status=PipelineStatus.active_work)
                     for st in students]
        db.add_all(contracts)
        await db.flush()

        def link(st, number, contract=None, status=3):
            return TrustMeContractLink(student_id=st.id, financial_contract_id=contract, company_id='c', external_id=uuid.uuid4().hex[:10],
                                       short_url=uuid.uuid4().hex[:10], name='Договор', number=number, status=status, signers=[])

        def scan(st, name):
            return Document(student_id=st.id, uploaded_by=fin.id, doc_type=DocType.contract_scan, file_name=name,
                            file_size=10, mime_type='application/pdf', storage_path=f'scans/{name}')

        linked = link(students[0], '501', contracts[0].id)
        loose = link(students[1], '502')
        revoked = link(students[1], '999', status=4)
        scan_doc = scan(students[2], 'Договор скан.pdf')
        # У первого есть и скан, но привязанный TrustMe важнее.
        db.add_all([linked, loose, revoked, scan_doc, scan(students[0], 'лишний.pdf')])
        await db.commit()
        ids = [c.id for c in contracts]

    app = FastAPI()
    from app.api.v1.router import api_router
    app.include_router(api_router)

    async def db_dep():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_dep
    app.dependency_overrides[get_current_user] = lambda: fin
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://t/api/v1/') as client:
        rows = {}
        for cid in ids:
            r = await client.get(f'finance/contracts/{cid}')
            assert r.status_code == 200, r.text
            rows[cid] = r.json()['originals']
        assert rows[ids[0]] == [{'kind': 'trustme', 'id': str(linked.id), 'label': 'Договор №501'}]
        assert rows[ids[1]] == [{'kind': 'trustme', 'id': str(loose.id), 'label': 'Договор №502'}]  # отозванный не показан
        assert rows[ids[2]] == [{'kind': 'scan', 'id': str(scan_doc.id), 'label': 'Договор скан.pdf'}]
        assert rows[ids[3]] == []

        listed = await client.get('finance/contracts', params={'status': 'all', 'q': s, 'size': 100})
        assert {i['contract_id']: i['originals'] for i in listed.json()['items']}[str(ids[2])][0]['kind'] == 'scan'

        got = await client.get(f'finance/contracts/{ids[2]}/scan/{scan_doc.id}')
        assert got.status_code == 200 and got.content == '%PDF-scans/Договор скан.pdf'.encode()
        assert got.headers['content-type'] == 'application/pdf'
        # Скан другого ученика через чужой договор не отдаётся.
        assert (await client.get(f'finance/contracts/{ids[0]}/scan/{scan_doc.id}')).status_code == 404
    await engine.dispose()
