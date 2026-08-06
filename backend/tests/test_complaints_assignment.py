"""Чистая логика, без БД/сети — правило видимости обращения.

Пересылка жалобы держится на одной ветке: назначенный видит обращение даже при
visible_to_role=admin_only. Без неё ментор получал уведомление и 404 при
открытии — то есть пересылка была сломана by design.
"""
import unittest
import uuid

from app.api.v1.endpoints.complaints import can_view_complaint_rules, is_legal_risk
from app.models.confidential_note import NoteVisibility
from app.models.user import UserRole

AUTHOR = uuid.uuid4()
ASSIGNEE = uuid.uuid4()
STRANGER = uuid.uuid4()


class ComplaintVisibilityTests(unittest.TestCase):
    def test_legal_risk_detects_court_language(self):
        self.assertTrue(is_legal_risk("Требую возврат", "В противном случае обращусь в суд"))

    def test_legal_risk_does_not_escalate_regular_complaint(self):
        self.assertFalse(is_legal_risk("Не отвечает ментор", "Прошу помочь с коммуникацией"))

    def test_assignee_sees_admin_only_complaint(self):
        """Главный случай: админ переслал ментору жалобу, видимую только админам."""
        self.assertTrue(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=ASSIGNEE,
                visible_to_role=NoteVisibility.admin_only,
                viewer_id=ASSIGNEE,
                viewer_role=UserRole.mentor,
            )
        )

    def test_unassigned_mentor_does_not_see_admin_only(self):
        """Доступ получает только тот, кому переслали, а не все менторы."""
        self.assertFalse(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=ASSIGNEE,
                visible_to_role=NoteVisibility.admin_only,
                viewer_id=STRANGER,
                viewer_role=UserRole.mentor,
            )
        )

    def test_author_always_sees_own_complaint(self):
        self.assertTrue(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=None,
                visible_to_role=NoteVisibility.admin_only,
                viewer_id=AUTHOR,
                viewer_role=UserRole.student,
            )
        )

    def test_student_never_sees_someone_elses_complaint(self):
        self.assertFalse(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=None,
                visible_to_role=NoteVisibility.all_mentors,
                viewer_id=STRANGER,
                viewer_role=UserRole.student,
            )
        )

    def test_unassigned_complaint_falls_back_to_visibility(self):
        self.assertTrue(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=None,
                visible_to_role=NoteVisibility.all_mentors,
                viewer_id=STRANGER,
                viewer_role=UserRole.mentor,
            )
        )
        self.assertFalse(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=None,
                visible_to_role=NoteVisibility.admin_only,
                viewer_id=STRANGER,
                viewer_role=UserRole.mentor,
            )
        )

    def test_admin_sees_admin_only(self):
        self.assertTrue(
            can_view_complaint_rules(
                author_user_id=AUTHOR,
                assigned_to=None,
                visible_to_role=NoteVisibility.admin_only,
                viewer_id=STRANGER,
                viewer_role=UserRole.admin,
            )
        )


if __name__ == "__main__":
    unittest.main()
