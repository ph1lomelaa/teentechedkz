from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.services.audit import client_meta
from app.services.invites import invite_url, is_invite_usable


def _request(headers: dict[str, str], client_host: str | None):
    client = SimpleNamespace(host=client_host) if client_host is not None else None
    return SimpleNamespace(headers=headers, client=client)


class ClientMetaTests(unittest.TestCase):
    def test_prefers_first_forwarded_for_ip(self) -> None:
        req = _request(
            {"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "curl/8"},
            client_host="10.0.0.1",
        )
        ip, ua = client_meta(req)
        self.assertEqual(ip, "203.0.113.7")
        self.assertEqual(ua, "curl/8")

    def test_falls_back_to_client_host(self) -> None:
        req = _request({"user-agent": "Mozilla"}, client_host="192.168.1.50")
        ip, ua = client_meta(req)
        self.assertEqual(ip, "192.168.1.50")
        self.assertEqual(ua, "Mozilla")

    def test_handles_missing_client_and_headers(self) -> None:
        req = _request({}, client_host=None)
        ip, ua = client_meta(req)
        self.assertIsNone(ip)
        self.assertIsNone(ua)

    def test_none_request_is_safe(self) -> None:
        self.assertEqual(client_meta(None), (None, None))


class InviteUsabilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)

    def _invite(self, *, used_at=None, expires_in_hours=1):
        return SimpleNamespace(
            used_at=used_at,
            expires_at=self.now + timedelta(hours=expires_in_hours),
        )

    def test_fresh_invite_is_usable(self) -> None:
        self.assertTrue(is_invite_usable(self._invite(), self.now))

    def test_used_invite_is_not_usable(self) -> None:
        self.assertFalse(is_invite_usable(self._invite(used_at=self.now), self.now))

    def test_expired_invite_is_not_usable(self) -> None:
        self.assertFalse(is_invite_usable(self._invite(expires_in_hours=-1), self.now))

    def test_invite_url_uses_frontend_and_token(self) -> None:
        url = invite_url("abc123")
        self.assertTrue(url.endswith("/invite/abc123"))


if __name__ == "__main__":
    unittest.main()
