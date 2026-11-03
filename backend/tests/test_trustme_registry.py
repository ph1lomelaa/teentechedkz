import uuid
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.api.v1.endpoints import trustme_registry as registry
from app.models.user import UserRole


def user(role=UserRole.admin):
    return SimpleNamespace(id=uuid.uuid4(), role=role, permission_grants=[])


def doc(**extra):
    return SimpleNamespace(id=uuid.uuid4(), company_id='c', external_id='ext', short_url='4Kuowd19', number='671',
                           decision='review', reason='', link_id=None, **extra)


def result(value):
    return SimpleNamespace(scalar_one_or_none=lambda: value)


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_mentor_does_not_see_company_registry(self):
        db = SimpleNamespace(execute=AsyncMock())
        with patch.object(registry, 'require_access'), self.assertRaises(HTTPException) as error:
            await registry.list_registry(db, user(UserRole.mentor))
        self.assertEqual(error.exception.status_code, 403)
        db.execute.assert_not_awaited()

    async def test_contract_of_another_card_is_not_relinked(self):
        student = SimpleNamespace(id=uuid.uuid4())
        db = SimpleNamespace(get=AsyncMock(return_value=doc()), execute=AsyncMock(return_value=result(
            SimpleNamespace(student_id=uuid.uuid4(), id=uuid.uuid4()))), commit=AsyncMock())
        with patch.object(registry, '_student', AsyncMock(return_value=student)), patch.object(registry, '_client') as client:
            with self.assertRaises(HTTPException) as error:
                await registry.link_registry(uuid.uuid4(), registry.LinkBody(student_id=student.id), db, user())
        self.assertEqual(error.exception.status_code, 409)
        client.assert_not_called()

    async def test_unsigned_contract_is_not_linked(self):
        student = SimpleNamespace(id=uuid.uuid4())
        db = SimpleNamespace(get=AsyncMock(return_value=doc()), execute=AsyncMock(return_value=result(None)), rollback=AsyncMock())
        upstream = SimpleNamespace(contract=AsyncMock(return_value={'contract_status': 1}), pdf=AsyncMock())
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=upstream)
        client.__aexit__ = AsyncMock(return_value=False)
        with patch.object(registry, '_student', AsyncMock(return_value=student)), patch.object(registry, '_client', return_value=client):
            with self.assertRaises(HTTPException) as error:
                await registry.link_registry(uuid.uuid4(), registry.LinkBody(student_id=student.id), db, user())
        self.assertEqual(error.exception.status_code, 409)
        upstream.pdf.assert_not_awaited()

    async def test_dismissed_contract_leaves_queue_and_sync(self):
        item = doc()
        db = SimpleNamespace(get=AsyncMock(return_value=item), add=MagicMock(), commit=AsyncMock())
        with patch.object(registry, 'require_access'):
            await registry.dismiss_registry(item.id, db, user())
        # «detached» синхронизация пропускает — договор не вернётся в очередь.
        self.assertEqual(item.decision, 'detached')
        db.commit.assert_awaited()
