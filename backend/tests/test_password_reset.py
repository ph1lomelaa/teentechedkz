"""«Забыли пароль?» — ссылка на почту (06.10.2026).

Опасные места:
1. Ответ не должен выдавать, есть ли аккаунт с такой почтой.
2. Неактивному аккаунту ссылку не шлём — переход по ней активировал бы его
   мимо решения админа (`accept_invite` ставит is_active=True).
3. Письмо уходит и на привязанный Gmail, а не только на основную почту.
4. Без настроенного SMTP — честный 503, а не «отправили» в пустоту.
"""
import inspect
import unittest
import uuid
from email import message_from_string
from types import SimpleNamespace
from unittest import mock

from starlette.testclient import TestClient

from app.api.v1.endpoints import auth
from app.core.config import settings
from app.core.database import get_db
from app.main import app
from app.services import mailer, password_reset


class _FakeDb:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, *_a, **_kw):
        return None

    async def commit(self):
        self.commits += 1


def _user(**kw):
    data = dict(id=uuid.uuid4(), name="Айгерим", email="aigerim@corp.kz", is_active=True)
    data.update(kw)
    return SimpleNamespace(**data)


class PrepareResetTests(unittest.IsolatedAsyncioTestCase):
    async def _prepare(self, user, extras=()):
        db = _FakeDb()
        issue = mock.AsyncMock(return_value=(SimpleNamespace(), "TOKEN123", "CODE"))
        with mock.patch.object(password_reset, "resolve_user_by_email", mock.AsyncMock(return_value=user)), \
             mock.patch.object(password_reset, "issue_invite", issue), \
             mock.patch.object(password_reset, "list_extra_emails", mock.AsyncMock(return_value=list(extras))):
            letter = await password_reset.prepare_reset(db, "x@y.kz")
        return letter, issue

    async def test_unknown_email_gives_nothing_and_issues_no_link(self):
        letter, issue = await self._prepare(None)
        self.assertIsNone(letter)
        issue.assert_not_awaited()

    async def test_inactive_account_gets_no_link(self):
        letter, issue = await self._prepare(_user(is_active=False))
        self.assertIsNone(letter)
        issue.assert_not_awaited()

    async def test_letter_goes_to_primary_and_verified_gmail(self):
        extras = [
            SimpleNamespace(email="Aigerim@Gmail.com", is_verified=True),
            SimpleNamespace(email="unverified@gmail.com", is_verified=False),
        ]
        letter, _ = await self._prepare(_user(), extras)
        self.assertEqual(letter.recipients, ["aigerim@corp.kz", "aigerim@gmail.com"])
        self.assertIn("/invite/TOKEN123?reset=1", letter.url)
        self.assertIn(letter.url, letter.text)

    async def test_link_lives_for_configured_hours(self):
        _, issue = await self._prepare(_user())
        self.assertEqual(issue.await_args.kwargs["ttl_hours"], settings.PASSWORD_RESET_TTL_HOURS)


class LetterTests(unittest.TestCase):
    def test_letter_mentions_spam_and_expiry(self):
        _, text, body = password_reset.compose_letter(name="Ерлан", url="https://x/invite/t?reset=1", ttl_hours=2)
        self.assertIn("Спам", text)
        self.assertIn("2 часа", text)
        self.assertIn("Спам", body)

    def test_name_is_escaped_in_html(self):
        _, _, body = password_reset.compose_letter(name="<b>x</b>", url="https://x", ttl_hours=1)
        self.assertNotIn("<b>x</b>", body)
        self.assertIn("1 час", body)


class MessageHeadersTests(unittest.TestCase):
    def test_headers_that_spam_filters_check(self):
        with mock.patch.multiple(settings, SMTP_FROM="noreply@teenteched.kz", SMTP_FROM_NAME="TeenTechEd",
                                 SMTP_REPLY_TO=""):
            msg = mailer.build_message(to="a@b.kz", subject="Тема", text="текст", html="<p>текст</p>")
        parsed = message_from_string(msg.as_string())
        self.assertIn("noreply@teenteched.kz", parsed["From"])
        self.assertTrue(parsed["Message-ID"].endswith("@teenteched.kz>"))
        self.assertIsNotNone(parsed["Date"])
        self.assertEqual(msg.get_content_type(), "multipart/alternative")


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.db = _FakeDb()

        async def _db():
            yield self.db

        app.dependency_overrides[get_db] = _db
        self.client = TestClient(app)
        self.addCleanup(app.dependency_overrides.clear)
        patcher = mock.patch.object(auth.rate_limit, "enforce", mock.AsyncMock())
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_not_configured_is_503(self):
        with mock.patch.object(auth.mailer, "is_configured", return_value=False):
            res = self.client.post("/api/v1/auth/password-reset", json={"email": "a@b.kz"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.headers.get("x-error-code"), "MAIL_NOT_CONFIGURED")

    def test_same_answer_for_known_and_unknown_email(self):
        letter = password_reset.ResetLetter(
            user=_user(), recipients=["aigerim@corp.kz"], url="u", subject="s", text="t", html="h"
        )
        send = mock.AsyncMock()
        with mock.patch.object(auth.mailer, "is_configured", return_value=True), \
             mock.patch.object(auth.mailer, "send_mail", send), \
             mock.patch.object(auth, "record_audit"):
            with mock.patch.object(auth, "prepare_reset", mock.AsyncMock(return_value=None)):
                unknown = self.client.post("/api/v1/auth/password-reset", json={"email": "no@b.kz"})
            with mock.patch.object(auth, "prepare_reset", mock.AsyncMock(return_value=letter)):
                known = self.client.post("/api/v1/auth/password-reset", json={"email": "aigerim@corp.kz"})
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(unknown.json(), known.json())
        send.assert_awaited_once()
        self.assertEqual(send.await_args.kwargs["to"], ["aigerim@corp.kz"])

    def test_bad_email_is_422(self):
        with mock.patch.object(auth.mailer, "is_configured", return_value=True):
            res = self.client.post("/api/v1/auth/password-reset", json={"email": "nope"})
        self.assertEqual(res.status_code, 422)

    def test_endpoint_is_rate_limited_by_ip_and_email(self):
        source = inspect.getsource(auth.request_password_reset)
        self.assertIn('bucket="password_reset_ip"', source)
        self.assertIn('bucket="password_reset_email"', source)


if __name__ == "__main__":
    unittest.main()


class BulkTaskPermissionTests(unittest.TestCase):
    """05.10.2026: отказ по правам внутри bulk превращался в 422 «Ни одна задача
    не создана». Права постановщика проверяются до цикла по исполнителям."""

    def test_creator_rights_checked_before_loop(self):
        from app.api.v1.endpoints import tasks

        source = inspect.getsource(tasks.create_tasks_bulk)
        general = source.index('require_access(current_user, "tasks_general", Action.manage)')
        self.assertLess(general, source.index("for assignee_id in unique_ids"))
