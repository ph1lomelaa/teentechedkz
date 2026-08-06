import unittest
import uuid

from fastapi import HTTPException

from app.api.v1.endpoints.tasks import _validate_task_acceptance
from app.models.user import User, UserRole


class TaskAcceptanceTests(unittest.TestCase):
    def test_mentor_cannot_accept_result(self) -> None:
        mentor = User(id=uuid.uuid4(), role=UserRole.mentor)

        with self.assertRaisesRegex(HTTPException, "только МЗК или администратор"):
            _validate_task_acceptance(mentor, uuid.uuid4())

    def test_assignee_cannot_accept_own_result_even_if_mzk(self) -> None:
        mzk = User(id=uuid.uuid4(), role=UserRole.mzk_manager)

        with self.assertRaisesRegex(HTTPException, "собственный результат"):
            _validate_task_acceptance(mzk, mzk.id)

    def test_mzk_can_accept_another_users_result(self) -> None:
        mzk = User(id=uuid.uuid4(), role=UserRole.mzk_manager)

        _validate_task_acceptance(mzk, uuid.uuid4())

    def test_admin_can_accept_another_users_result(self) -> None:
        admin = User(id=uuid.uuid4(), role=UserRole.admin)

        _validate_task_acceptance(admin, uuid.uuid4())


if __name__ == "__main__":
    unittest.main()
