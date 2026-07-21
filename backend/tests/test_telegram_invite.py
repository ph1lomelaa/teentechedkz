from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.telegram_bot import _JOINED_STATUSES, is_invite_link_usable
from app.api.v1.endpoints.telegram_chats import build_group_title


class TelegramInviteLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)

    def _link(self, *, used_at=None, revoked=False, expires_in_hours=1):
        expires_at = None if expires_in_hours is None else self.now + timedelta(hours=expires_in_hours)
        return SimpleNamespace(used_at=used_at, revoked=revoked, expires_at=expires_at)

    def test_fresh_link_is_usable(self) -> None:
        self.assertTrue(is_invite_link_usable(self._link(), self.now))

    def test_no_expiry_is_usable(self) -> None:
        self.assertTrue(is_invite_link_usable(self._link(expires_in_hours=None), self.now))

    def test_used_link_is_not_usable(self) -> None:
        self.assertFalse(is_invite_link_usable(self._link(used_at=self.now), self.now))

    def test_revoked_link_is_not_usable(self) -> None:
        self.assertFalse(is_invite_link_usable(self._link(revoked=True), self.now))

    def test_expired_link_is_not_usable(self) -> None:
        self.assertFalse(is_invite_link_usable(self._link(expires_in_hours=-1), self.now))

    def test_only_membership_statuses_count_as_joined(self) -> None:
        self.assertIn("member", _JOINED_STATUSES)
        self.assertIn("administrator", _JOINED_STATUSES)
        self.assertNotIn("left", _JOINED_STATUSES)
        self.assertNotIn("kicked", _JOINED_STATUSES)

    def test_group_title_uses_student_country_and_year(self) -> None:
        self.assertEqual(
            build_group_title("  Алина   Садыкова ", " Казахстан ", 2027),
            "Алина Садыкова — Казахстан — 2027",
        )

    def test_group_title_without_country_is_valid_and_limited(self) -> None:
        title = build_group_title("Очень длинное имя " * 20, None, 2028)
        self.assertLessEqual(len(title), 128)
        self.assertFalse(title.endswith((" ", "—", "-")))


if __name__ == "__main__":
    unittest.main()
