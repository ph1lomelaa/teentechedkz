"""Снятие ответственного без замены.

Ради чего тест
--------------
Назначение делалось один раз и навсегда: снять ответственного было нельзя ни
из карточки, ни с доски. Снятие обязано оставить след в истории (кто, кого,
почему) и, для МЗК, убрать зеркало из договора — иначе задачи и уведомления,
читающие `contracts.mzk_manager_id`, продолжали бы слать всё снятому.
"""
import asyncio
import unittest
import uuid

from app.api.v1.endpoints.mentor_assignments import self_assign_role, unassign_one
from app.models.contract import Contract
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.mentor_assignment_history import MentorAssignmentHistory
from app.models.user import User, UserRole


class _Result:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class FakeSession:
    def __init__(self, contract=None):
        self._contract = contract
        self.added = []

    async def execute(self, _query):
        return _Result(self._contract)

    def add(self, obj):
        self.added.append(obj)


def _assignment(role, mentor_id):
    return MentorAssignment(
        student_id=uuid.uuid4(), mentor_id=mentor_id, role=role,
        is_active=True, assignment_status="active",
    )


class UnassignTests(unittest.TestCase):
    def test_unassign_deactivates_and_writes_history(self) -> None:
        mentor_id = uuid.uuid4()
        ma = _assignment(MentorRole.lead, mentor_id)
        session = FakeSession()

        asyncio.run(unassign_one(session, ma=ma, reason="ушла из команды", actor_id=uuid.uuid4()))

        self.assertFalse(ma.is_active)
        self.assertEqual(ma.assignment_status, "removed")
        history = [x for x in session.added if isinstance(x, MentorAssignmentHistory)]
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0].previous_mentor_id, mentor_id)
        self.assertIsNone(history[0].replacement_mentor_id)

    def test_unassigned_mzk_is_cleared_from_contract(self) -> None:
        mentor_id = uuid.uuid4()
        contract = Contract(mzk_manager_id=mentor_id)
        session = FakeSession(contract=contract)

        asyncio.run(unassign_one(
            session, ma=_assignment(MentorRole.mzk, mentor_id), reason="x", actor_id=uuid.uuid4()
        ))

        self.assertIsNone(contract.mzk_manager_id)

    def test_contract_of_another_mzk_is_untouched(self) -> None:
        other = uuid.uuid4()
        contract = Contract(mzk_manager_id=other)
        session = FakeSession(contract=contract)

        asyncio.run(unassign_one(
            session, ma=_assignment(MentorRole.mzk, uuid.uuid4()), reason="x", actor_id=uuid.uuid4()
        ))

        self.assertEqual(contract.mzk_manager_id, other)


class SelfAssignRoleTests(unittest.TestCase):
    def test_mzk_manager_adds_self_as_mzk(self) -> None:
        # Раньше «Добавить себя» от МЗК-менеджера писало его ментором по УП.
        self.assertEqual(self_assign_role(User(role=UserRole.mzk_manager)), MentorRole.mzk)

    def test_mentor_adds_self_as_lead(self) -> None:
        self.assertEqual(self_assign_role(User(role=UserRole.mentor)), MentorRole.lead)


if __name__ == "__main__":
    unittest.main()
