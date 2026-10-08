import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, mock

from app.api.v1.endpoints import documents
from app.models.document import DocSource, DocType, Document
from app.models.user import UserRole


class DocumentDisplayNameTests(IsolatedAsyncioTestCase):
    async def test_rename_changes_download_name_without_touching_storage(self):
        user_id = uuid.uuid4()
        doc = Document(
            id=uuid.uuid4(), student_id=uuid.uuid4(), uploaded_by=user_id,
            doc_type=DocType.other, file_name="original.pdf", file_size=10,
            mime_type="application/pdf", storage_path="student/object-key",
            source=DocSource.manual_upload, uploaded_at=datetime.now(timezone.utc),
            visible_to_student=True, signature_status="none", is_verified=False,
        )
        db = mock.MagicMock()
        db.get = mock.AsyncMock(return_value=doc)
        db.commit = mock.AsyncMock()
        db.refresh = mock.AsyncMock()
        user = SimpleNamespace(id=user_id, role=UserRole.admin)
        with mock.patch.object(documents, "require_access"), \
             mock.patch.object(documents, "require_student_access", new=mock.AsyncMock()), \
             mock.patch.object(documents, "log_change", new=mock.AsyncMock()):
            result = await documents.rename_document(doc.id, {"name": "IELTS/6.5"}, db, user)

        self.assertEqual(result["display_name"], "IELTS_6.5")
        self.assertEqual(documents._download_name(doc), "IELTS_6.5.pdf")
        self.assertEqual(doc.file_name, "original.pdf")
        self.assertEqual(doc.storage_path, "student/object-key")
