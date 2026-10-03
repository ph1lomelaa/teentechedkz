"""Регламент admission: доступы к порталам вуза.

Повод — поддельный оффер, который вскрылся, только когда студент прилетел в
страну обучения. Отсюда два правила:
- доступы вносит персонал, студент их только смотрит;
- оффер/зачисление без доступов к порталу отметить нельзя.
"""
import unittest
import uuid

from fastapi import HTTPException

from app.api.v1.endpoints.credentials import _assert_manage, _assert_read
from app.models.application import Application, SubmissionStatus as S
from app.models.user import UserRole
from app.services.admission_guard import (
    has_portal_credentials,
    needs_portal_check,
    require_portal_credentials,
)

STUDENT_ID = uuid.uuid4()


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def all(self):
        return []


class FakeDb:
    def __init__(self, value=None):
        self.value = value
        self.statements = []

    async def execute(self, stmt):
        self.statements.append(stmt)
        return FakeResult(self.value)


def user(role):
    return type("U", (), {"role": role, "id": uuid.uuid4(), "permission_grants": []})()


def application(*, university_id=None, with_id=True):
    app = Application(student_id=STUDENT_ID, country="DE", university_id=university_id)
    app.id = uuid.uuid4() if with_id else None
    return app


class StatusTransitionTests(unittest.TestCase):
    def test_entering_offer_or_enrolled_is_checked(self):
        for old in (S.not_started, S.documents_prep, S.submitted, S.rejected, None):
            for new in (S.offer_received, S.enrolled):
                with self.subTest(old=old, new=new):
                    self.assertTrue(needs_portal_check(old, new))

    def test_other_statuses_are_not_blocked(self):
        for new in (S.not_started, S.documents_prep, S.submitted, S.rejected):
            with self.subTest(new=new):
                self.assertFalse(needs_portal_check(S.not_started, new))

    def test_already_guarded_application_is_not_rechecked(self):
        """Заявки, которые стояли в оффере до правила, правятся свободно."""
        self.assertFalse(needs_portal_check(S.offer_received, S.offer_received))
        self.assertFalse(needs_portal_check(S.offer_received, S.enrolled))


class PortalCredentialsTests(unittest.IsolatedAsyncioTestCase):
    async def test_found_credential_passes(self):
        db = FakeDb(value=uuid.uuid4())
        self.assertTrue(await has_portal_credentials(db, application(university_id=uuid.uuid4())))

    async def test_missing_credential_fails(self):
        db = FakeDb(value=None)
        self.assertFalse(await has_portal_credentials(db, application()))

    async def test_unsaved_free_text_application_has_nothing_to_match(self):
        db = FakeDb(value=uuid.uuid4())
        self.assertFalse(await has_portal_credentials(db, application(with_id=False)))
        self.assertEqual(db.statements, [])

    async def test_matches_by_application_and_by_university(self):
        db = FakeDb(value=None)
        await has_portal_credentials(db, application(university_id=uuid.uuid4()))
        sql = str(db.statements[0])
        self.assertIn("application_id", sql)
        self.assertIn("university_id", sql)
        self.assertIn("student_id", sql)

    async def test_offer_without_credentials_is_rejected_with_code(self):
        with self.assertRaises(HTTPException) as ctx:
            await require_portal_credentials(FakeDb(None), application(), S.submitted, S.offer_received)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertEqual(ctx.exception.headers["X-Error-Code"], "PORTAL_CREDENTIALS_REQUIRED")

    async def test_rejection_does_not_query(self):
        db = FakeDb(None)
        await require_portal_credentials(db, application(), S.submitted, S.rejected)
        self.assertEqual(db.statements, [])


class CredentialAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_student_reads_own_credentials(self):
        await _assert_read(FakeDb(value=STUDENT_ID), STUDENT_ID, user(UserRole.student))

    async def test_student_cannot_read_someone_elses(self):
        with self.assertRaises(HTTPException) as ctx:
            await _assert_read(FakeDb(value=uuid.uuid4()), STUDENT_ID, user(UserRole.student))
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_student_cannot_manage_even_own(self):
        with self.assertRaises(HTTPException) as ctx:
            await _assert_manage(FakeDb(value=STUDENT_ID), STUDENT_ID, user(UserRole.student))
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_staff_manage(self):
        for role in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
            with self.subTest(role=role):
                await _assert_manage(FakeDb(), STUDENT_ID, user(role))
