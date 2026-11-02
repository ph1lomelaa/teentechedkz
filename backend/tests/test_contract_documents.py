import unittest
import uuid
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, UploadFile
from reportlab.pdfgen.canvas import Canvas

from app.api.v1.endpoints import trustme, acts
from app.models.user import UserRole
from app.services.contract_documents import read_pages, signing_date, document_signing_date
from app.services.contract_profile import extract_profile, cached_profile


def pdf():
    stream = BytesIO()
    canvas = Canvas(stream)
    canvas.drawString(50, 700, 'Contract 123 - ordinary text PDF for a student')
    canvas.save()
    return stream.getvalue()


def user():
    return SimpleNamespace(id=uuid.uuid4(), role=UserRole.admin, permission_grants=[])


class DocumentTests(unittest.TestCase):
    def test_only_explicit_signing_dates_are_read_from_pdf(self):
        self.assertIsNone(document_signing_date([{'text': 'ДОГОВОР №123 от 28.07.2026'}]))
        self.assertEqual(document_signing_date([{'text': 'Дата подписания договора: 01.08.2026'}]), '2026-08-01')
        self.assertIsNone(document_signing_date([{'text': 'Дата подписания: 01.08.2026 Дата подписания: 02.08.2026'}]))

    def test_created_date_is_not_signing_date(self):
        self.assertIsNone(signing_date({'contract_status': 3, 'created_at': '2026-09-01'}))
        self.assertIsNone(signing_date({'contract_status': 1, 'signed_at': '2026-09-01'}))
        self.assertEqual(signing_date({'contract_status': 3, 'signed_at': '2026-09-01T12:00:00Z'}), '2026-09-01')
        self.assertEqual(signing_date({'contract_status': 3, 'signed_at': '2026-09-01T22:00:00Z'}), '2026-09-02')

    def test_both_parties_must_have_confirmed_signing_dates(self):
        info = {'doc_parties': [{'signed': True, 'signedAt': '2026-09-01'}, {'signed': True, 'signedAt': '2026-09-03'}]}
        self.assertEqual(signing_date(info), '2026-09-03')
        info['doc_parties'][1]['signed'] = False
        self.assertIsNone(signing_date(info))
        info['doc_parties'][1] = {'signed': True}
        self.assertIsNone(signing_date(info))

    def test_real_trustme_date_sign_field_and_last_signature_date(self):
        info = {'contract_status': 3, 'doc_parties': [
            {'signed': True, 'date_sign': '2026-07-14T17:17:04.035132'},
            {'signed': True, 'date_sign': '2026-07-15T16:41:42.007243'},
        ]}
        self.assertEqual(signing_date(info), '2026-07-15')
        info['doc_parties'][1]['signed'] = False
        self.assertIsNone(signing_date(info))

    def test_references_are_codes_on_the_expected_host_never_arbitrary_fetches(self):
        self.assertEqual(trustme.contract_reference('https://trustme.kz/contract/4Kuowd19?x=y'), '4Kuowd19')
        self.assertEqual(trustme.contract_reference('4Kuowd19'), '4Kuowd19')
        for value in ('https://evil.example/4Kuowd19', 'https://trustme.kz.evil.example/4Kuowd19', 'http://trustme.kz/4Kuowd19', 'https://user@trustme.kz/4Kuowd19', '../../private'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                trustme.contract_reference(value)

    def test_pdf_requires_valid_parseable_pdf(self):
        self.assertIn('ordinary text', read_pages(pdf(), ocr=False)[0]['text'])
        for content in (b'not a pdf', b'%PDF-broken'):
            with self.assertRaises(Exception):
                read_pages(content, ocr=False)

    def test_header_dates_and_invalid_dates(self):
        for header, expected in [('2026 жылғы «28» шілде', '2026-07-28'), ('28/07/2026', '2026-07-28'), ('2026-07-28', '2026-07-28'), ('31.02.2026', None)]:
            result = extract_profile([{'page': 1, 'text': header}], {}, b'pdf')
            self.assertEqual(result['fields'].get('contract_date'), expected)


class ManualContractTests(unittest.IsolatedAsyncioTestCase):
    def db(self, existing=None):
        saved = []
        async def flush():
            for item in saved:
                if isinstance(item, trustme.TrustMeContractLink):
                    item.id = uuid.uuid4(); item.linked_at = datetime.now(timezone.utc)
        return SimpleNamespace(get=AsyncMock(return_value=object()), execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: existing)),
            add=saved.append, flush=flush, commit=AsyncMock(), rollback=AsyncMock(), saved=saved)

    async def test_upload_requires_student_confirmation_and_valid_pdf_before_storage(self):
        for confirmed, content in [(False, pdf()), (True, b'bad')]:
            with patch.object(trustme, 'minio_upload', new_callable=AsyncMock) as store:
                with self.assertRaises(HTTPException) as error:
                    await trustme.upload_contract(uuid.uuid4(), self.db(), user(), UploadFile(filename='x.pdf', file=BytesIO(content)), 'Contract', confirmed, False)
                self.assertEqual(error.exception.status_code, 422)
                store.assert_not_awaited()

    async def test_upload_records_manual_origin_and_never_invents_signing_date(self):
        db = self.db()
        with patch.object(trustme, 'minio_upload', new_callable=AsyncMock, return_value='stored.pdf'), patch.object(trustme, '_client') as upstream:
            result = await trustme.upload_contract(uuid.uuid4(), db, user(), UploadFile(filename='x.pdf', file=BytesIO(pdf())), 'Manual contract', True, False)
        self.assertEqual(result['source'], 'manual')
        self.assertEqual(result['status'], 0)
        self.assertIsNone(result['signed_date'])
        self.assertEqual(db.saved[0].storage_path, 'stored.pdf')
        self.assertIsNotNone(cached_profile(db.saved[0]))
        upstream.assert_not_called()
        db.commit.assert_awaited_once()

    async def test_manual_signed_contract_is_verified_locally_and_pdf_is_local(self):
        link = SimpleNamespace(source='manual', status=3, storage_path='stored.pdf')
        with patch.object(acts, '_client') as upstream:
            await acts._verify_contract(link)
        upstream.assert_not_called()
        link.status = 0
        with self.assertRaises(HTTPException):
            await acts._verify_contract(link)

    async def test_text_search_passes_exact_query_without_guardian_expansion(self):
        db = self.db()
        db.get.return_value = SimpleNamespace(full_name='Student Name')
        db.execute.return_value = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: ['Parent Name']))
        client = SimpleNamespace(search=AsyncMock(return_value=SimpleNamespace(candidates=[], queries=['671'], truncated=False)))
        context = AsyncMock(); context.__aenter__.return_value = client
        with patch.object(trustme, '_client', return_value=context):
            await trustme.search_contracts(uuid.uuid4(), trustme.SearchRequest(query='671', mode='text'), db, user())
        client.search.assert_awaited_once_with('671', (), max_pages=3, exact=True)

# Real multipart request + PostgreSQL round trip. Storage alone is substituted.
import asyncio
import os
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.student import Student, DegreeLevel
from app.models.user import User
from test_service_acts import payload


@pytest.mark.skipif(not os.environ.get('FINANCE_TEST_DATABASE_URL'), reason='Requires disposable PostgreSQL')
def test_manual_contract_roundtrip_and_acts():
    url = os.environ['FINANCE_TEST_DATABASE_URL']
    assert '/tte_finance_check_' in url
    asyncio.run(manual_roundtrip(url))


async def manual_roundtrip(url):
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex
    async with sessions() as db:
        admin = User(name='Договоры Админ', email=f'contract-{suffix}@example.test', role=UserRole.admin, hashed_password='x', is_active=True)
        viewer = User(name='Договоры Финансы', email=f'contract-view-{suffix}@example.test', role=UserRole.finance_manager, hashed_password='x', is_active=True)
        students = [Student(full_name=f'Тест Студент {i} {suffix}', degree_level=DegreeLevel.undergraduate, intake_year=2027,
            phone=f'+7700{uuid.uuid4().int % 10000000:07d}') for i in range(2)]
        db.add_all([admin, viewer, *students]); await db.commit()
    app = FastAPI(); app.include_router(trustme.router); app.include_router(acts.router)
    current = [admin]
    async def database():
        async with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: current[0]
    content = pdf()
    with patch.object(trustme, 'minio_upload', AsyncMock(return_value='test/contract.pdf')), patch.object(trustme, 'minio_download', AsyncMock(return_value=content)), patch.object(acts, 'minio_download', AsyncMock(return_value=content)), patch.object(acts, 'minio_upload', AsyncMock(return_value='test/act.pdf')), patch.object(acts, '_client', side_effect=AssertionError('Manual contract must not contact TrustMe')):
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            sid = students[0].id; other = students[1].id
            base = f'/trustme/students/{sid}'
            response = await client.post(base+'/upload', files={'file': ('contract.pdf', content, 'application/pdf')}, data={'name': 'Договор родителя', 'identity_confirmed': 'true', 'signed_confirmed': 'false'})
            assert response.status_code == 201, response.text
            link = response.json(); lid = link['id']
            assert link['source'] == 'manual' and link['status'] == 0 and link['signed_date'] is None
            duplicate = await client.post(base+'/upload', files={'file': ('duplicate.pdf', content, 'application/pdf')}, data={'name': 'Duplicate', 'identity_confirmed': 'true'})
            assert duplicate.status_code == 201 and duplicate.json()['id'] == lid
            wrong_student = await client.post(f'/trustme/students/{other}/upload', files={'file': ('same.pdf', content, 'application/pdf')}, data={'name': 'Wrong student', 'identity_confirmed': 'true'})
            assert wrong_student.status_code == 409
            assert (await client.get(f'/acts/students/{sid}/contracts/{lid}/pdf')).content == content
            assert (await client.get(f'/acts/students/{other}/contracts/{lid}/pdf')).status_code == 404
            details = {'name': 'Проверенный договор', 'contract_number': 'TEST-671', 'contract_date': '2026-07-28', 'signed_date': '2026-08-01', 'customer_name': 'Другой Подписант', 'student_name': students[0].full_name, 'signed_confirmed': True}
            response = await client.patch(base+f'/links/{lid}/details', json=details)
            assert response.status_code == 200, response.text
            response = await client.post(base+f'/links/{lid}/inspect')
            assert response.status_code == 200, response.text
            assert response.json()['fields']['contract_date'] == details['contract_date']  # correction survives re-extraction
            links = (await client.get(base+'/links')).json()
            assert links[0]['signed_date'] == '2026-08-01' and links[0]['signed_date_source'] == 'manual'
            assert links[0]['customer_name'] == 'Другой Подписант'
            context = (await client.get(f'/acts/students/{sid}')).json()
            assert context['contracts'][0]['contract_date'] == '2026-07-28'
            assert context['contracts'][0]['signed_date'] == '2026-08-01'
            quote_response = await client.post(f'/acts/students/{sid}/contracts/{lid}/service-quote', json={'page':1,'text':'Contract 123 - ordinary text PDF for a student'})
            assert quote_response.status_code == 200, quote_response.text
            quote = quote_response.json()
            inspected = (await client.post(f'/acts/students/{sid}/contracts/{lid}/inspect')).json()
            act_data = {**payload(), 'include_amount':False, 'contract_link_id':lid, 'lines':[{'name':quote['name'],'result':quote['text'],'contract_source':quote['reference'],'contract_service_id':quote['id'],'source_fingerprint':inspected['fingerprint'],'quantity':'1','unit':'услуга'}]}
            draft = await client.post(f'/acts/students/{sid}', json=act_data)
            assert draft.status_code == 201, draft.text
            generated = await client.post(f"/acts/{draft.json()['id']}/generate")
            assert generated.status_code == 200, generated.text
            assert generated.json()['status'] == 'ready'
            duplicate = await client.post(f'/acts/students/{sid}/preview', json=act_data)
            assert duplicate.status_code == 409
            fake_quote = await client.post(f'/acts/students/{sid}/contracts/{lid}/service-quote', json={'page':1,'text':'Этих выполненных работ в договоре никогда не было'})
            assert fake_quote.status_code == 422
            subset = await client.post(f'/acts/students/{sid}/contracts/{lid}/service-quote', json={'page':1,'text':'ordinary text PDF for a student'})
            assert subset.status_code == 200 and subset.json()['id'] == quote['id']
            unproven_offer = await client.post(f'/acts/students/{sid}/preview', json={**act_data,'template':'offer'})
            assert unproven_offer.status_code == 422
            from app.models.application import Application, SubmissionStatus
            from app.schemas.service_act import ActInput
            async with sessions() as db:
                own_application = Application(student_id=sid,country='Тестовая страна',university='Тестовый университет',program='Тестовая программа',submission_status=SubmissionStatus.offer_received)
                other_application = Application(student_id=other,country='Тестовая страна',university='Чужой университет',submission_status=SubmissionStatus.enrolled)
                db.add_all([own_application,other_application]);await db.flush()
                parent_link = await db.get(trustme.TrustMeContractLink,uuid.UUID(lid))
                evidence = ActInput(**{**act_data,'template':'offer','application_ids':[str(own_application.id)],'verified_outcomes':['Несуществующий грант']})
                await acts._check_work_evidence(db,sid,evidence,parent_link)
                assert evidence.verified_outcomes == ['Оффер получен: Тестовый университет, Тестовая программа']
                evidence.application_ids = [other_application.id]
                try:
                    await acts._check_work_evidence(db,sid,evidence,parent_link)
                    raise AssertionError('Another student cannot supply admission evidence')
                except HTTPException as error:
                    assert error.status_code == 422
                evidence.template='admission';evidence.application_ids=[own_application.id]
                try:
                    await acts._check_work_evidence(db,sid,evidence,parent_link)
                    raise AssertionError('An offer does not prove enrollment')
                except HTTPException as error:
                    assert error.status_code == 422
                await db.rollback()
            # Ready acts retain their confirmed parent contract.
            assert (await client.patch(base+f'/links/{lid}/details', json={**details, 'signed_confirmed': False})).status_code == 409
            current[0] = viewer
            assert (await client.patch(base+f'/links/{lid}/details', json=details)).status_code == 403
            assert (await client.post(base+'/upload', files={'file': ('contract.pdf', content, 'application/pdf')}, data={'name': 'Attempt', 'identity_confirmed': 'true'})).status_code == 403
    await engine.dispose()
