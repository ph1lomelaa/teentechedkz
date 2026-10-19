import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, mock

from fastapi import HTTPException
from app.api.v1.endpoints import documents
from app.models.document import DocSource, DocType, Document
from app.models.user import UserRole


class DocumentReviewWorkflowTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=uuid.uuid4(), role=UserRole.admin)
        self.doc = Document(
            id=uuid.uuid4(), student_id=uuid.uuid4(), uploaded_by=self.user.id,
            doc_type=DocType.other, file_name='demo.pdf', file_size=10,
            mime_type='application/pdf', storage_path='student/demo',
            source=DocSource.manual_upload, uploaded_at=datetime.now(timezone.utc),
            visible_to_student=False, signature_status='none', is_verified=False,
        )
        self.db = mock.MagicMock()
        self.db.get = mock.AsyncMock(return_value=self.doc)
        self.db.execute = mock.AsyncMock(return_value=mock.Mock(scalar_one_or_none=mock.Mock(return_value=self.doc)))
        self.db.commit = mock.AsyncMock()
        self.db.refresh = mock.AsyncMock()
        for name in ('require_access', 'require_student_access', 'log_change'):
            patcher = mock.patch.object(documents, name, new=mock.MagicMock() if name == 'require_access' else mock.AsyncMock())
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    async def test_review_and_reopen_do_not_change_visibility_or_acknowledgment(self):
        for body, expected in ((None, True), ({'is_verified': False}, False)):
            result = await documents.verify_document(self.doc.id, self.db, self.user, body)
            self.assertEqual(result['is_verified'], expected)
            self.assertFalse(self.doc.visible_to_student)
            self.assertEqual(self.doc.signature_status, 'none')
        self.assertEqual(self.log_change.await_count, 2)
        self.require_student_access.assert_awaited()

    async def test_unchanged_review_is_idempotent_and_invalid_value_rejected(self):
        await documents.verify_document(self.doc.id, self.db, self.user, {'is_verified': False})
        self.log_change.assert_not_awaited()
        with self.assertRaises(HTTPException) as error:
            await documents.verify_document(self.doc.id, self.db, self.user, {'is_verified': 'false'})
        self.assertEqual(error.exception.status_code, 422)

    async def test_showing_file_does_not_complete_review(self):
        await documents.set_visibility(self.doc.id, {'visible_to_student': True}, self.db, self.user)
        self.assertTrue(self.doc.visible_to_student)
        self.assertFalse(self.doc.is_verified)

    async def test_hiding_cancels_pending_request_but_preserves_review(self):
        self.doc.signature_status = 'pending'
        self.doc.is_verified = True
        self.doc.signature_viewed_at = datetime.now(timezone.utc)
        await documents.set_visibility(self.doc.id, {'visible_to_student': False}, self.db, self.user)
        self.assertEqual(self.doc.signature_status, 'none')
        self.assertIsNone(self.doc.signature_viewed_at)
        self.assertTrue(self.doc.is_verified)

    async def test_request_opens_document_without_marking_it_reviewed(self):
        await documents.request_document_signature(self.doc.id, self.db, self.user)
        self.assertTrue(self.doc.visible_to_student)
        self.assertEqual(self.doc.signature_status, 'pending')
        self.assertFalse(self.doc.is_verified)

    async def test_repeated_request_preserves_viewed_time(self):
        self.doc.signature_status = 'pending'
        viewed = self.doc.signature_viewed_at = datetime.now(timezone.utc)
        requested = self.doc.signature_requested_at = datetime.now(timezone.utc)
        await documents.request_document_signature(self.doc.id, self.db, self.user)
        self.assertEqual(self.doc.signature_viewed_at, viewed)
        self.assertEqual(self.doc.signature_requested_at, requested)

    async def test_confirmed_document_cannot_be_requested_again_or_erased_by_hide(self):
        self.doc.signature_status = 'signed'
        self.doc.signature_full_name = 'Demo Student'
        signed = self.doc.signature_signed_at = datetime.now(timezone.utc)
        with self.assertRaises(HTTPException) as error:
            await documents.request_document_signature(self.doc.id, self.db, self.user)
        self.assertEqual(error.exception.status_code, 409)
        await documents.set_visibility(self.doc.id, {'visible_to_student': False}, self.db, self.user)
        self.assertEqual(self.doc.signature_signed_at, signed)
        self.assertEqual(self.doc.signature_full_name, 'Demo Student')
        self.assertEqual(self.doc.signature_status, 'signed')
