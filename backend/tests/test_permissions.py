import unittest
import uuid

from fastapi import HTTPException

from app.core.deps import has_permission, require_permission
from app.models.user import User, UserRole


class PermissionMatrixTests(unittest.TestCase):
    def _user(self, role: UserRole) -> User:
        return User(id=uuid.uuid4(), role=role)

    def test_admin_has_management_and_work_permissions(self):
        admin = self._user(UserRole.admin)
        self.assertTrue(has_permission(admin, "manage_users"))
        self.assertTrue(has_permission(admin, "assign_mentor_tasks"))

    def test_mzk_can_delegate_but_not_manage_users(self):
        mzk = self._user(UserRole.mzk_manager)
        self.assertTrue(has_permission(mzk, "assign_mentor_tasks"))
        self.assertFalse(has_permission(mzk, "manage_users"))

    def test_mentor_and_student_cannot_delegate(self):
        for role in (UserRole.mentor, UserRole.student):
            with self.subTest(role=role):
                self.assertFalse(has_permission(self._user(role), "assign_mentor_tasks"))

    def test_unknown_permission_is_rejected(self):
        with self.assertRaises(HTTPException) as context:
            require_permission(self._user(UserRole.admin), "made_up_permission")
        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()