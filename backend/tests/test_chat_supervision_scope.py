import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from app.api.v1.endpoints.chat import list_conversations
from app.models.user import UserRole


@pytest.mark.parametrize('role', [UserRole.mentor, UserRole.student])
def test_all_student_chat_scope_requires_a_supervisor_before_any_database_read(role):
    db = SimpleNamespace(execute=AsyncMock())
    user = SimpleNamespace(id=uuid4(), role=role)
    with pytest.raises(HTTPException) as raised:
        asyncio.run(list_conversations(user, db, mentor_id=None, scope='all'))
    assert raised.value.status_code == 403
    db.execute.assert_not_awaited()


@pytest.mark.parametrize('role', [UserRole.admin, UserRole.mzk_manager, UserRole.academic_head])
def test_supervisor_gets_student_chat_overview_with_one_read_and_no_membership_change(role):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    conv = SimpleNamespace(id=uuid4(), type=SimpleNamespace(value='direct'), title=None, created_at=now)
    student = SimpleNamespace(id=uuid4(), full_name='Test student', user_id=uuid4())
    rows = [(conv, student, 'Student', UserRole.student, 'Test message', now, uuid4(), False)]
    db = SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=lambda: rows)))
    user = SimpleNamespace(id=uuid4(), role=role)
    result = asyncio.run(list_conversations(user, db, mentor_id=None, scope='all'))
    assert result[0]['student']['id'] == str(student.id)
    assert result[0]['last_message']['body'] == 'Test message'
    assert result[0]['can_write'] is False
    assert result[0]['unread'] == 0
    db.execute.assert_awaited_once()
