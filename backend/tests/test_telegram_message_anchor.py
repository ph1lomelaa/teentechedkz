import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import pytest
from unittest import IsolatedAsyncioTestCase
from fastapi import HTTPException
from app.api.v1.endpoints.telegram_chats import list_chat_messages

class TelegramMessageAnchorTests(IsolatedAsyncioTestCase):
    async def test_old_message_anchor_is_included_and_chat_access_is_checked_first(self):
        chat_id, message_id = uuid.uuid4(), uuid.uuid4()
        anchor = SimpleNamespace(id=message_id, chat_id=chat_id, created_at=datetime.now(timezone.utc))
        result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
        db = SimpleNamespace(get=AsyncMock(side_effect=[SimpleNamespace(id=chat_id), anchor]), execute=AsyncMock(return_value=result))
        with patch('app.api.v1.endpoints.telegram_chats._require_chat_access', new_callable=AsyncMock) as access:
            assert await list_chat_messages(chat_id, db, 'staff', q=None, limit=200, before_id=None, around_id=message_id) == []
            access.assert_awaited_once_with(db, chat_id, 'staff')
        statement = db.execute.call_args.args[0]
        assert message_id in statement.compile().params.values()
        assert '<=' in str(statement)

    async def test_anchor_from_another_chat_is_rejected(self):
        chat_id = uuid.uuid4()
        db = SimpleNamespace(get=AsyncMock(side_effect=[SimpleNamespace(id=chat_id), SimpleNamespace(chat_id=uuid.uuid4())]), execute=AsyncMock())
        with patch('app.api.v1.endpoints.telegram_chats._require_chat_access', new_callable=AsyncMock):
            with pytest.raises(HTTPException) as error:
                await list_chat_messages(chat_id, db, 'staff', q=None, limit=200, before_id=None, around_id=uuid.uuid4())
        assert error.value.status_code == 404
        db.execute.assert_not_awaited()
