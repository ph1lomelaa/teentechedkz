import unittest
from types import SimpleNamespace
from app.services.contract_discovery import match_student


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.student = SimpleNamespace(full_name='Жолдас Нұрай Бекболатқызы', phone='+77001234567')
        self.profile = {'fields': {'student_name': 'Жолдас Нурай Бекболаткызы'}, 'sources': {'student_name': {'kind': 'pdf'}}}

    def match(self, names=None, pages=None):
        return match_student(self.student, self.profile, pages or [], names or [self.student.full_name])[0]

    def test_exact_full_recipient_is_automatically_confirmed_even_when_parent_signs(self):
        self.profile['fields']['customer_name'] = 'Другой Подписант'
        self.assertEqual(self.match(), 'confirmed')

    def test_parent_name_or_title_alone_is_not_enough(self):
        self.profile['fields'] = {'customer_name': self.student.full_name}
        self.assertEqual(self.match(), 'review')

    def test_other_child_with_the_same_parent_is_filtered_out(self):
        self.profile['fields']['student_name'] = 'Жолдас Дина Бекболатқызы'
        self.assertEqual(self.match(), 'unrelated')

    def test_duplicate_full_names_are_never_automatically_bound(self):
        self.assertEqual(self.match(names=[self.student.full_name, self.student.full_name]), 'review')

    def test_two_word_name_needs_a_matching_phone_in_the_pdf(self):
        self.student.full_name = 'Жолдас Нұрай'
        self.profile['fields']['student_name'] = 'Жолдас Нурай'
        self.assertEqual(self.match(), 'review')
        self.assertEqual(self.match(pages=[{'text': 'Номер телефона: +7 (700) 123-45-67'}]), 'confirmed')

    def test_ocr_or_metadata_is_not_used_as_automatic_identity_proof(self):
        for kind in ('ocr', 'trustme', 'manual'):
            self.profile['sources']['student_name']['kind'] = kind
            self.assertEqual(self.match(), 'review')

import asyncio
import os
import uuid
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from app.api.v1.endpoints import trustme
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.student import Student, DegreeLevel
from app.models.user import User, UserRole
from app.models.trustme_contract import TrustMeContractLink, TrustMeDocument


@pytest.mark.skipif(not os.environ.get('FINANCE_TEST_DATABASE_URL'), reason='Requires disposable PostgreSQL')
def test_automatic_discovery_reads_pdf_links_only_recipient_and_caches():
    url = os.environ['FINANCE_TEST_DATABASE_URL']
    assert '/tte_finance_check_' in url
    asyncio.run(discovery_scenario(url))


async def discovery_scenario(url):
    engine = create_async_engine(url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    suffix = uuid.uuid4().hex
    letters = suffix.translate(str.maketrans('0123456789', 'abcdefghij'))
    name = f'Тестов Аслан{letters} Серикович'
    async with sessions() as db:
        admin = User(name='Автоподбор Тест', email=f'auto-{suffix}@example.test', role=UserRole.admin, hashed_password='x', is_active=True)
        student = Student(full_name=name, phone='+77001234567', degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add_all([admin, student]); await db.commit()
    font = Path(__file__).resolve().parents[1]/'app/assets/fonts/NotoSans-Regular.ttf'
    pdfmetrics.registerFont(TTFont('DiscoveryTest', str(font)))
    def document(recipient):
        stream = BytesIO(); canvas = Canvas(stream); canvas.setFont('DiscoveryTest', 10)
        for i, line in enumerate(['ДОГОВОР № 123 г. Алматы «28» июля 2026 г.', 'Подписант / законный представитель: Другая Мама', *( [f'Абитуриент: {recipient}', 'ИИН абитуриента: 000000000000'] if recipient else [] )]):
            canvas.drawString(40, 790-i*20, line)
        canvas.save(); return stream.getvalue()
    documents = {'autoLink1': document(name), 'autoLink2': document(None), 'autoLink3': document('Другой Ребёнок Серикович'), 'autoLink4': document(name)}
    # autoLink4 — тот же студент, но договор не подписан: только на подтверждение.
    rows = [{'id': f'{suffix}-{i}', 'shortUrl': code, 'contractName': f'Договор {name}', 'contractStatus': 1 if code == 'autoLink4' else 3, 'signers': []} for i, code in enumerate(documents)]
    async with sessions() as db:
        # Реестр нашёл договор по телефону, а поиск по ФИО его не видит.
        db.add(TrustMeDocument(company_id='test-auto', external_id=f'{suffix}-reg', short_url='regLink1', name='Договор с другим написанием',
                               number='408', status=1, decision='review', reason='Не подписан · В договоре телефон из карточки', candidate_ids=[str(student.id)]))
        await db.commit()
    class Provider:
        company_id = 'test-auto'
        calls = 0
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def search(self, *args, **kwargs):
            self.calls += 1
            return SimpleNamespace(candidates=rows, truncated=False)
        async def contract(self, short):
            row = next(r for r in rows if r['shortUrl'] == short)
            return {'id': row['id'], 'contract_status': row['contractStatus'], 'contract_name': row['contractName'], 'doc_parties': []}
        async def pdf(self, short): return documents[short]
    class Cache:
        values = {}
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def get(self, key): return self.values.get(key)
        async def set(self, key, value, nx=False, **kwargs):
            if nx and key in self.values: return False
            self.values[key] = value; return True
        async def eval(self, script, count, key, token):
            if self.values.get(key) == token: self.values.pop(key)
    provider = Provider(); cache = Cache()
    app = FastAPI(); app.include_router(trustme.router)
    async def database():
        async with sessions() as db: yield db
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_user] = lambda: admin
    with patch.object(trustme, '_client', return_value=provider), patch('redis.asyncio.Redis.from_url', return_value=cache):
        async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
            endpoint = f'/trustme/students/{student.id}/auto-link'
            response = await client.post(endpoint)
            assert response.status_code == 200, response.text
            data = response.json()
            assert data['state'] == 'complete', data
            assert len(data['linked_ids']) == 1, data
            assert sorted(row['short_url'] for row in data['review']) == ['autoLink2', 'autoLink4', 'regLink1'], data
            unsigned = next(row for row in data['review'] if row['short_url'] == 'autoLink4')
            assert unsigned['reason'].startswith('Не подписан'), unsigned
            calls = provider.calls
            assert (await client.post(endpoint)).json() == data
            assert provider.calls == calls  # opening again does not repeat corporate search
    async with sessions() as db:
        links = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id == student.id))).scalars().all()
        assert len(links) == 1 and links[0].short_url == 'autoLink1'
        assert trustme._link_dict(links[0])['contract_date'] == '2026-07-28'
    await engine.dispose()


class TypoHintTests(unittest.TestCase):
    def test_one_letter_typo_gives_review_hint_but_never_links(self):
        from app.services.contract_matching import pick_student
        student = SimpleNamespace(id='1', full_name='Клименко Артеа Денисович', phone='')
        other = SimpleNamespace(id='2', full_name='Иванов Иван Иванович', phone='')
        profile = {'fields': {'student_name': 'Клименко Артем Денисович'}, 'sources': {'student_name': {'kind': 'pdf'}}}
        decision, found, _ = pick_student(profile, [], [student, other], {}, [student.full_name, other.full_name], 'Договор')
        self.assertEqual(decision, 'review')
        self.assertEqual([s.id for s in found], ['1'])

    def test_unrelated_names_are_not_hinted(self):
        from app.services.contract_discovery import fuzzy_overlap
        self.assertEqual(fuzzy_overlap('Клименко Артем Денисович', 'Иванов Иван Иванович'), 0)
        self.assertEqual(fuzzy_overlap('Раазан Әмір', 'Рамазан Әмір Манасұлы'), 2)


class UnsignedReadTests(unittest.IsolatedAsyncioTestCase):
    async def _read(self, status):
        from unittest.mock import AsyncMock, MagicMock, patch
        from app.services import trustme_sync as sync
        student = SimpleNamespace(id='s1', full_name='Клименко Артем Денисович')
        client = SimpleNamespace(contract=AsyncMock(return_value={'contract_status': status}), pdf=AsyncMock(return_value=b'%PDF'))
        doc = SimpleNamespace(short_url='abc', name='Договор', number='1', facts_encrypted=None, decision=None, candidate_ids=None, reason=None)
        people = SimpleNamespace(students=[student], guardians={}, names=[student.full_name])
        with patch.object(sync, 'read_pages', return_value=[{'page': 1, 'text': 'текст'}]), \
             patch.object(sync, 'extract_profile', return_value={'fields': {}, 'sources': {}}), \
             patch.object(sync, 'recover_student_identity', side_effect=lambda p, *a: p), \
             patch.object(sync, 'facts_of', return_value={}), patch.object(sync, 'encrypt', return_value='x'), \
             patch.object(sync, 'pick_student', return_value=('link', student, 'Студент однозначно указан в договоре')), \
             patch.object(sync, '_link', AsyncMock()) as link:
            result = await sync.read_and_decide(MagicMock(), client, doc, people, apply=True)
        return result, doc, link

    async def test_unsigned_contract_goes_to_review_and_is_never_linked(self):
        (decision, found, reason), doc, link = await self._read(1)
        self.assertEqual((decision, doc.decision), ('review', 'review'))
        self.assertEqual(doc.candidate_ids, ['s1'])
        self.assertTrue(reason.startswith('Не подписан'))
        link.assert_not_awaited()

    async def test_signed_contract_is_still_linked(self):
        (decision, *_), doc, link = await self._read(3)
        self.assertEqual(decision, 'link')
        link.assert_awaited_once()

    async def test_revoked_contract_is_skipped(self):
        (decision, *_), doc, link = await self._read(4)
        self.assertEqual(decision, 'unsigned')
        link.assert_not_awaited()
