"""Чистая логика ОКК МЗК — область видимости баллов и валидация периода.

Контекст: раньше все четыре эндпоинта были строго админскими, при этом пункт
меню «ОКК МЗК» показывался и МЗК-менеджеру — он попадал на страницу, где всё
отдавало 403. Теперь менеджер видит свой помесячный балл, но только свой:
параметр запроса для него игнорируется, а не сверяется, чтобы подстановка
чужого id ничего не давала.
"""
import unittest
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.api.v1.endpoints.mzk_quality import resolve_score_scope, validate_period, validate_review_source
from app.models.user import UserRole

ME = uuid.uuid4()
COLLEAGUE = uuid.uuid4()
NOW = datetime(2026, 8, 5, tzinfo=timezone.utc)


class ScoreScopeTests(unittest.TestCase):
    def test_manager_is_scoped_to_self_even_asking_for_a_colleague(self):
        """Главное правило: чужой id не даёт чужих оценок."""
        self.assertEqual(
            resolve_score_scope(
                viewer_role=UserRole.mzk_manager,
                viewer_id=ME,
                requested_manager_id=str(COLLEAGUE),
            ),
            ME,
        )

    def test_manager_without_param_sees_own(self):
        self.assertEqual(
            resolve_score_scope(
                viewer_role=UserRole.mzk_manager, viewer_id=ME, requested_manager_id=None
            ),
            ME,
        )

    def test_admin_sees_everyone_by_default(self):
        self.assertIsNone(
            resolve_score_scope(viewer_role=UserRole.admin, viewer_id=ME, requested_manager_id=None)
        )

    def test_admin_may_filter_by_any_manager(self):
        self.assertEqual(
            resolve_score_scope(
                viewer_role=UserRole.admin, viewer_id=ME, requested_manager_id=str(COLLEAGUE)
            ),
            COLLEAGUE,
        )

    def test_mentor_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            resolve_score_scope(
                viewer_role=UserRole.mentor, viewer_id=ME, requested_manager_id=None
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_student_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            resolve_score_scope(
                viewer_role=UserRole.student, viewer_id=ME, requested_manager_id=str(COLLEAGUE)
            )
        self.assertEqual(ctx.exception.status_code, 403)

    def test_admin_malformed_uuid_is_422(self):
        with self.assertRaises(HTTPException) as ctx:
            resolve_score_scope(
                viewer_role=UserRole.admin, viewer_id=ME, requested_manager_id="мусор"
            )
        self.assertEqual(ctx.exception.status_code, 422)


class PeriodValidationTests(unittest.TestCase):
    def test_current_month_is_allowed(self):
        validate_period(2026, 8, now=NOW)

    def test_past_month_is_allowed(self):
        validate_period(2025, 12, now=NOW)

    def test_future_month_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            validate_period(2026, 9, now=NOW)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_future_year_is_rejected(self):
        with self.assertRaises(HTTPException):
            validate_period(2027, 1, now=NOW)

    def test_december_of_previous_year_is_not_confused_with_future(self):
        """Сравнение по кортежу, а не по месяцу отдельно."""
        validate_period(2025, 12, now=datetime(2026, 1, 5, tzinfo=timezone.utc))

    def test_month_out_of_range(self):
        for bad in (0, 13, -1):
            with self.subTest(month=bad):
                with self.assertRaises(HTTPException):
                    validate_period(2026, bad, now=NOW)


class ReviewSourceValidationTests(unittest.TestCase):
    def test_unknown_source_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            validate_review_source("unknown", uuid.uuid4(), COLLEAGUE, ME)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_manager_cannot_be_review_source(self):
        with self.assertRaises(HTTPException) as ctx:
            validate_review_source("manual", COLLEAGUE, COLLEAGUE, ME)
        self.assertEqual(ctx.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
