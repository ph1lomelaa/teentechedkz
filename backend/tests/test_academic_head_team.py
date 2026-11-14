"""Академ-хед управляет всей командой ученика: любая роль, замена, снятие.

Аружан (academic_head) не могла сменить или снять ментора из списка учеников.
Бэкенд по роли вызывающего ничего не режет — тест держит это правилом: появится
проверка «эту роль назначает только админ» — тест упадёт.
"""
import asyncio
import uuid
from types import SimpleNamespace
from unittest import mock

import pytest

from app.api.v1.endpoints import mentor_assignments as ep
from app.core.permissions import Action, allows
from app.models.mentor_assignment import ASSIGNABLE_ROLES, MentorAssignment
from app.models.user import UserRole


def _head():
    return SimpleNamespace(id=uuid.uuid4(), role=UserRole.academic_head, is_active=True, permission_grants=[])


@pytest.mark.parametrize("resource,action", [
    ("mentor_assignments", Action.manage), ("assignment_overview", Action.view), ("users", Action.view),
])
def test_academic_head_has_team_rights(resource, action):
    assert allows(resource=resource, action=action, role=UserRole.academic_head)


@pytest.mark.parametrize("role", [r.value for r in ASSIGNABLE_ROLES])
def test_academic_head_assigns_any_role(role):
    ma = MentorAssignment(id=uuid.uuid4(), student_id=uuid.uuid4(), mentor_id=uuid.uuid4(), is_active=True)
    db = mock.Mock(commit=mock.AsyncMock())
    db.execute = mock.AsyncMock(return_value=SimpleNamespace(scalar_one=lambda: ma))
    with mock.patch.object(ep, "_load_assignable_mentor", mock.AsyncMock(return_value=SimpleNamespace(id=ma.mentor_id))), \
         mock.patch.object(ep, "has_pending_agreement_signature", mock.AsyncMock(return_value=False)), \
         mock.patch.object(ep, "_assign_one", mock.AsyncMock(return_value=("created", ma))) as assign, \
         mock.patch.object(ep, "_ma_to_dict", lambda row: {"id": str(row.id)}):
        out = asyncio.run(ep.create_assignment({"role": role, "mentor_id": str(ma.mentor_id), "student_id": str(ma.student_id)}, db, _head()))
    assert out == {"id": str(ma.id)}
    assert assign.await_args.kwargs["role"].value == role


def test_academic_head_unassigns():
    ma = MentorAssignment(id=uuid.uuid4(), student_id=uuid.uuid4(), mentor_id=uuid.uuid4(), is_active=True)
    db = mock.Mock(commit=mock.AsyncMock(), get=mock.AsyncMock(return_value=ma))
    with mock.patch.object(ep, "unassign_one", mock.AsyncMock()) as unassign:
        out = asyncio.run(ep.unassign_assignment(ma.id, {"reason": "сменили ментора"}, db, _head()))
    assert out == {"ok": True}
    unassign.assert_awaited_once()
