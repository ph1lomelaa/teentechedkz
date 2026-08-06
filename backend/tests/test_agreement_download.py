"""Чистая логика — кому отдавать файл регламента.

Регрессия: GET /agreements/{id}/download стоял на голом CurrentUser вообще без
проверок, поэтому любой авторизованный мог выкачать любой регламент — включая
неопубликованные черновики и регламенты чужой аудитории.
"""
import unittest

from app.api.v1.endpoints.agreements import can_download_agreement
from app.models.agreement import AgreementAudience, AgreementStatus
from app.models.user import UserRole


class DownloadAccessTests(unittest.TestCase):
    def test_admin_may_download_draft(self):
        """Админ готовит черновики, поэтому видит их до публикации."""
        self.assertTrue(
            can_download_agreement(
                viewer_role=UserRole.admin,
                audience=AgreementAudience.mentor,
                status=AgreementStatus.draft,
            )
        )

    def test_mentor_may_download_published_mentor_agreement(self):
        self.assertTrue(
            can_download_agreement(
                viewer_role=UserRole.mentor,
                audience=AgreementAudience.mentor,
                status=AgreementStatus.published,
            )
        )

    def test_mentor_may_not_download_draft(self):
        self.assertFalse(
            can_download_agreement(
                viewer_role=UserRole.mentor,
                audience=AgreementAudience.mentor,
                status=AgreementStatus.draft,
            )
        )

    def test_mentor_may_not_download_student_agreement(self):
        self.assertFalse(
            can_download_agreement(
                viewer_role=UserRole.mentor,
                audience=AgreementAudience.student,
                status=AgreementStatus.published,
            )
        )

    def test_student_may_not_download_mentor_agreement(self):
        self.assertFalse(
            can_download_agreement(
                viewer_role=UserRole.student,
                audience=AgreementAudience.mentor,
                status=AgreementStatus.published,
            )
        )

    def test_student_may_download_own_published(self):
        self.assertTrue(
            can_download_agreement(
                viewer_role=UserRole.student,
                audience=AgreementAudience.student,
                status=AgreementStatus.published,
            )
        )

    def test_mzk_manager_maps_to_mzk_audience(self):
        self.assertTrue(
            can_download_agreement(
                viewer_role=UserRole.mzk_manager,
                audience=AgreementAudience.mzk,
                status=AgreementStatus.published,
            )
        )

    def test_archived_is_not_downloadable_by_non_admin(self):
        self.assertFalse(
            can_download_agreement(
                viewer_role=UserRole.mentor,
                audience=AgreementAudience.mentor,
                status=AgreementStatus.archived,
            )
        )


if __name__ == "__main__":
    unittest.main()
