from __future__ import annotations

import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api.v1.endpoints.notes import delete_note


class DeleteNotePermissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_other_mentor_cannot_delete_note(self):
        owner_id = uuid.uuid4()
        db = SimpleNamespace(get=AsyncMock(return_value=SimpleNamespace(created_by=owner_id)),
                             delete=AsyncMock(), commit=AsyncMock())
        user = SimpleNamespace(id=uuid.uuid4(), role='mentor')

        with patch('app.api.v1.endpoints.notes.allows', return_value=False):
            with self.assertRaises(HTTPException) as raised:
                await delete_note(uuid.uuid4(), user, db)

        self.assertEqual(raised.exception.status_code, 403)
        db.delete.assert_not_awaited()
        db.commit.assert_not_awaited()

    async def test_author_can_delete_own_note(self):
        owner_id = uuid.uuid4()
        note = SimpleNamespace(created_by=owner_id)
        db = SimpleNamespace(get=AsyncMock(return_value=note), delete=AsyncMock(), commit=AsyncMock())
        user = SimpleNamespace(id=owner_id, role='mentor')

        result = await delete_note(uuid.uuid4(), user, db)

        self.assertEqual(result, {'ok': True})
        db.delete.assert_awaited_once_with(note)
        db.commit.assert_awaited_once()
