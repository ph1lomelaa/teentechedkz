"""Acceptance invariants for the regulatory scenarios.

The live API flows remain in the e2e scripts; these tests lock the small,
high-risk decisions that must also hold when an endpoint is called directly.
"""
import unittest
import uuid
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.api.v1.endpoints.complaints import is_legal_risk
from app.api.v1.endpoints.contract_addenda import _business_day
from app.api.v1.endpoints.mzk_quality import validate_period, validate_review_source
from app.api.v1.endpoints.refund_cases import _require_approved_change_basis
from app.api.v1.endpoints.tasks import _validate_task_acceptance
from app.models.mentor_task_penalty import MentorTaskPenalty, PenaltyColor
from app.models.user import User, UserRole
from app.services.agreements import signature_covers_version
from app.services.task_urgency import task_urgency
from app.services.task_urgency_notifier import violation_color_for_urgency
import app.services.task_urgency_notifier as task_urgency_notifier


class Stage13AcceptanceInvariantTests(unittest.TestCase):
    def test_unsigned_current_version_is_not_eligible(self):
        self.assertFalse(signature_covers_version(signed_version=1, current_version=2))
        self.assertTrue(signature_covers_version(signed_version=2, current_version=2))

    def test_mzk_cannot_accept_own_result(self):
        manager = User(id=uuid.uuid4(), role=UserRole.mzk_manager)
        with self.assertRaises(HTTPException):
            _validate_task_acceptance(manager, manager.id)

    def test_mentor_cannot_accept_result(self):
        with self.assertRaises(HTTPException):
            _validate_task_acceptance(User(id=uuid.uuid4(), role=UserRole.mentor), uuid.uuid4())

    def test_stage_cannot_be_funded_by_unapproved_refund_change(self):
        with self.assertRaises(HTTPException):
            _require_approved_change_basis({})

    def test_legal_risk_is_detected(self):
        self.assertTrue(is_legal_risk("Требую возврат", "Обращусь в суд"))

    def test_invalid_quality_source_is_rejected(self):
        with self.assertRaises(HTTPException):
            validate_review_source("unknown", uuid.uuid4(), uuid.uuid4(), uuid.uuid4())

    def test_future_quality_period_is_rejected(self):
        with self.assertRaises(HTTPException):
            validate_period(2027, 1, now=datetime(2026, 8, 6, tzinfo=timezone.utc))

    def test_resume_tasks_use_business_days(self):
        self.assertEqual(_business_day(date(2026, 8, 7), 1), date(2026, 8, 10))

    def test_critical_overdue_is_a_red_violation(self):
        self.assertEqual(task_urgency(date(2026, 8, 1), "open", today=date(2026, 8, 6)), "critical")
        self.assertEqual(violation_color_for_urgency("critical"), PenaltyColor.red)
        self.assertIsNone(violation_color_for_urgency("orange"))


class _NotifierResult:
    def __init__(self, rows=()):
        self._rows = list(rows)

    def all(self):
        return self._rows


class _NotifierDb:
    def __init__(self, task, student, admin_id, mzk_id, mentor_id):
        self.task = task
        self.student = student
        self.admin_id = admin_id
        self.mzk_id = mzk_id
        self.mentor_id = mentor_id
        self.added = []
        self.commits = 0

    async def execute(self, statement):
        query = str(statement)
        if "student_tasks" in query:
            return _NotifierResult([(self.task, self.student)])
        if "mzk_manager_id" in query:
            return _NotifierResult([(self.student.id, self.mzk_id)])
        return _NotifierResult([(self.admin_id,)])

    async def scalar(self, statement):
        query = str(statement)
        if "mentor_task_penalties" in query:
            return None
        return UserRole.mentor

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        self.commits += 1

    async def refresh(self, value):
        return None

    async def rollback(self):
        return None

    async def close(self):
        return None


class Stage13OverdueWorkflowTests(unittest.IsolatedAsyncioTestCase):
    async def test_critical_overdue_registers_one_violation_and_notifies_staff(self):
        task_id = uuid.uuid4()
        mentor_id = uuid.uuid4()
        admin_id = uuid.uuid4()
        mzk_id = uuid.uuid4()
        student = SimpleNamespace(id=uuid.uuid4(), full_name="Тестовый студент")
        task = SimpleNamespace(
            id=task_id,
            student_id=student.id,
            assignee_id=mentor_id,
            task_text="Сдать результат",
            due_date=date(2026, 8, 1),
            status="open",
        )
        db = _NotifierDb(task, student, admin_id, mzk_id, mentor_id)
        notes = []

        def fake_notify(db_arg, user_id, **kwargs):
            note = SimpleNamespace(user_id=user_id, **kwargs)
            notes.append(note)
            return note

        async def fake_push(note):
            return None

        with patch.object(task_urgency_notifier, "AsyncSessionLocal", return_value=db), \
             patch.object(task_urgency_notifier, "has_unread", return_value=False), \
             patch.object(task_urgency_notifier, "notify", side_effect=fake_notify), \
             patch.object(task_urgency_notifier, "push_notification", side_effect=fake_push):
            await task_urgency_notifier.check_critical_overdue_tasks()

        penalties = [item for item in db.added if isinstance(item, MentorTaskPenalty)]
        self.assertEqual(len(penalties), 1)
        self.assertEqual(penalties[0].task_id, task_id)
        self.assertEqual(penalties[0].mentor_id, mentor_id)
        self.assertEqual(penalties[0].color, PenaltyColor.red)
        self.assertEqual({note.user_id for note in notes}, {admin_id, mzk_id})
        self.assertEqual(db.commits, 1)


if __name__ == "__main__":
    unittest.main()