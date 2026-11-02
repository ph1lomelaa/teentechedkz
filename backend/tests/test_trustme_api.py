import json
import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api.v1.endpoints import trustme
from app.models.user import UserRole
from app.services.trustme import TrustMeChallengeRequired


def user(role=UserRole.admin):
    return SimpleNamespace(id=uuid.uuid4(), role=role, permission_grants=[])


class ApiTests(unittest.IsolatedAsyncioTestCase):
    def test_candidate_excludes_private_requisites_and_unsafe_url(self):
        row = trustme._candidate({
            'shortUrl': 'https://evil.example/', 'contractName': 'Contract',
            'signers': [{'jsonData': json.dumps([
                {'key': 'fio', 'value': 'Test Parent'},
                {'key': 'tinBin', 'value': 'private-id'},
                {'key': 'phoneNumber', 'value': 'private-phone'}]), 'signed': True}],
        })
        self.assertIsNone(row['short_url'])
        self.assertEqual(row['signers'][0]['name'], 'Test Parent')
        self.assertNotIn('private', json.dumps(row))

    async def test_student_cannot_search_corporate_contracts(self):
        db = SimpleNamespace(get=AsyncMock())
        with self.assertRaises(HTTPException) as error:
            await trustme.search_contracts(uuid.uuid4(), trustme.SearchRequest(query='Name'), db,
                                            user(UserRole.student))
        self.assertEqual(error.exception.status_code, 403)
        db.get.assert_not_awaited()

    async def test_missing_student_does_not_contact_trustme(self):
        with patch.object(trustme, '_client') as client:
            with self.assertRaises(HTTPException) as error:
                await trustme.search_contracts(uuid.uuid4(), trustme.SearchRequest(mode='name'),
                                                SimpleNamespace(get=AsyncMock(return_value=None)), user())
        self.assertEqual(error.exception.status_code, 404)
        client.assert_not_called()

    async def test_identity_confirmation_is_required_before_upstream_call(self):
        db = SimpleNamespace(get=AsyncMock(return_value=object()))
        with patch.object(trustme, '_client') as client:
            with self.assertRaises(HTTPException) as error:
                await trustme.link_contract(uuid.uuid4(), trustme.LinkRequest(
                    short_url='4Kuowd19', identity_confirmed=False), db, user())
        self.assertEqual(error.exception.status_code, 422)
        client.assert_not_called()

    async def test_revoked_contract_cannot_be_linked(self):
        db = SimpleNamespace(get=AsyncMock(return_value=object()), execute=AsyncMock())
        upstream = SimpleNamespace(company_id='company', contract=AsyncMock(return_value={
            'contract_status': 4, 'id': 'doc'}))
        context = AsyncMock()
        context.__aenter__.return_value = upstream
        with patch.object(trustme, '_client', return_value=context):
            with self.assertRaises(HTTPException) as error:
                await trustme.link_contract(uuid.uuid4(), trustme.LinkRequest(
                    short_url='4Kuowd19', identity_confirmed=True), db, user())
        self.assertEqual(error.exception.status_code, 409)
        db.execute.assert_not_awaited()

    async def test_document_already_linked_to_another_student_is_rejected(self):
        existing = SimpleNamespace(student_id=uuid.uuid4())
        db = SimpleNamespace(get=AsyncMock(return_value=object()), execute=AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: existing)))
        context = AsyncMock()
        context.__aenter__.return_value = SimpleNamespace(company_id='company',
            contract=AsyncMock(return_value={'contract_status': 3, 'id': 'document'}))
        with patch.object(trustme, '_client', return_value=context):
            with self.assertRaises(HTTPException) as error:
                await trustme.link_contract(uuid.uuid4(), trustme.LinkRequest(
                    short_url='4Kuowd19', identity_confirmed=True), db, user())
        self.assertEqual(error.exception.status_code, 409)

    async def test_link_is_saved_with_server_metadata_and_audit(self):
        saved = []
        def add(item):
            saved.append(item)
        async def flush():
            for item in saved:
                if isinstance(item, trustme.TrustMeContractLink):
                    item.id = uuid.uuid4()
                    item.linked_at = datetime.now(timezone.utc)
        db = SimpleNamespace(get=AsyncMock(return_value=object()), execute=AsyncMock(
            return_value=SimpleNamespace(scalar_one_or_none=lambda: None)),
            add=add, flush=flush, commit=AsyncMock())
        context = AsyncMock()
        context.__aenter__.return_value = SimpleNamespace(company_id='company', contract=AsyncMock(return_value={
            'contract_status': 3, 'id': 'verified-document', 'contract_name': 'Verified name',
            'number_deal': '474', 'doc_parties': [], 'created_at': '2026-07-28'}))
        with patch.object(trustme, '_client', return_value=context):
            result = await trustme.link_contract(uuid.uuid4(), trustme.LinkRequest(
                short_url='4Kuowd19', identity_confirmed=True), db, user())
        self.assertEqual(result['name'], 'Verified name')
        self.assertEqual(saved[0].external_id, 'verified-document')
        self.assertEqual(len(saved), 2)  # link plus audit record
        db.commit.assert_awaited_once()

    async def test_unlink_cannot_remove_another_students_link(self):
        db = SimpleNamespace(get=AsyncMock(side_effect=[object(), SimpleNamespace(student_id=uuid.uuid4())]),
                             delete=AsyncMock(), execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(student_id=uuid.uuid4()))))
        with self.assertRaises(HTTPException) as error:
            await trustme.unlink_contract(uuid.uuid4(), uuid.uuid4(), db, user())
        self.assertEqual(error.exception.status_code, 404)
        db.delete.assert_not_awaited()

    async def test_mentor_cannot_list_other_students_corporate_documents(self):
        db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(first=lambda: None)), get=AsyncMock())
        with self.assertRaises(HTTPException) as error:
            await trustme.list_links(uuid.uuid4(), db, user(UserRole.mentor))
        self.assertEqual(error.exception.status_code, 404)
        db.get.assert_not_awaited()

    def test_challenge_has_distinct_error_code(self):
        error = trustme._upstream(TrustMeChallengeRequired('Manual verification'))
        self.assertEqual(error.status_code, 503)
        self.assertEqual(error.headers['X-Error-Code'], 'TRUSTME_CHALLENGE_REQUIRED')


if __name__ == '__main__':
    unittest.main()
