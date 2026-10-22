import unittest
import uuid
from types import SimpleNamespace
from unittest import mock

from fastapi import HTTPException
from starlette.requests import Request

from app.api.v1.endpoints import auth
from app.models.audit_log import AuditAction
from app.models.user_email import UserEmail
from app.services.google_account_status import confirmed_accounts
from app.services.meeting_bot.platforms import detect_platform


class GoogleStatusTests(unittest.TestCase):
    def setUp(self):
        self.user = SimpleNamespace(id=uuid.uuid4(), email='primary@gmail.com')

    def event(self, action=AuditAction.google_linked, email='primary@gmail.com', **meta):
        return SimpleNamespace(actor_user_id=self.user.id, action=action, meta={'email': email, **meta})

    def extra(self, email, verified=True):
        return SimpleNamespace(user_id=self.user.id, email=email, is_verified=verified)

    def status(self, extras=(), events=()):
        return confirmed_accounts([self.user], list(extras), list(events))[self.user.id]

    def test_gmail_domain_and_manually_added_address_are_not_oauth_confirmation(self):
        self.assertFalse(self.status([self.extra('other@gmail.com')])['linked'])

    def test_primary_google_is_visible_without_consuming_an_extra_slot(self):
        self.assertEqual(self.status(events=[self.event()]), {'linked': True, 'emails': ['primary@gmail.com']})

    def test_only_current_verified_addresses_count(self):
        events = [self.event(email='removed@gmail.com'), self.event(email='pending@gmail.com'), self.event(email='personal@gmail.com')]
        extras = [self.extra('pending@gmail.com', False), self.extra('personal@gmail.com')]
        self.assertEqual(self.status(extras, events)['emails'], ['personal@gmail.com'])

    def test_latest_unlink_removes_confirmation_even_if_staff_readded_the_address(self):
        events = [self.event(AuditAction.google_unlinked, 'personal@gmail.com'), self.event(email='personal@gmail.com')]
        self.assertFalse(self.status([self.extra('personal@gmail.com')], events)['linked'])

    def test_google_login_proves_the_actual_email_not_the_primary_snapshot(self):
        event = self.event(AuditAction.login_success, method='google', google_email='personal@gmail.com')
        self.assertEqual(self.status([self.extra('personal@gmail.com')], [event])['emails'], ['personal@gmail.com'])

    def test_old_google_login_without_actual_email_does_not_guess_the_primary(self):
        event = SimpleNamespace(actor_user_id=self.user.id, action=AuditAction.login_success,
                                actor_email=self.user.email, meta={'method': 'google'})
        self.assertFalse(self.status(events=[event])['linked'])

    def test_meet_creation_page_cannot_be_sent_to_the_bot(self):
        self.assertIsNone(detect_platform('https://meet.google.com/new'))
        self.assertEqual(detect_platform('https://meet.google.com/abc-defg-hij'), 'google_meet')


class GoogleLinkEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def call(self, email='primary@gmail.com', verified=True, extras=(), occupied=False):
        self.user = SimpleNamespace(id=uuid.uuid4(), email='primary@gmail.com', name='Test')
        self.db = SimpleNamespace(add=mock.Mock(), commit=mock.AsyncMock())
        self.audit = mock.Mock()
        self.status = mock.AsyncMock(return_value={'primary': self.user.email, 'extras': [],
                                                   'google_account': {'linked': True, 'emails': [email]}})
        request = Request({'type': 'http', 'headers': [], 'client': ('127.0.0.1', 1234)})
        with mock.patch.object(auth, 'verify_google_id_token', return_value=SimpleNamespace(email=email, email_verified=verified)), \
             mock.patch.object(auth.rate_limit, 'enforce', mock.AsyncMock()), \
             mock.patch.object(auth, 'list_extra_emails', mock.AsyncMock(return_value=list(extras))), \
             mock.patch.object(auth, 'email_in_use', mock.AsyncMock(return_value=occupied)), \
             mock.patch.object(auth, 'record_audit', self.audit), \
             mock.patch.object(auth, '_my_emails_payload', self.status):
            return await auth.link_google_account({'credential': 'verified-google-token'}, request, self.user, self.db)

    async def test_primary_is_audited_and_does_not_create_a_duplicate_extra(self):
        result = await self.call()
        self.assertTrue(result['google_account']['linked'])
        self.db.add.assert_not_called()
        self.audit.assert_called_once()
        self.assertEqual(self.audit.call_args.kwargs['meta'], {'email': 'primary@gmail.com'})
        self.db.commit.assert_awaited_once()

    async def test_google_proof_verifies_a_preexisting_extra(self):
        extra = SimpleNamespace(email='personal@gmail.com', is_verified=False)
        await self.call('personal@gmail.com', extras=[extra])
        self.assertTrue(extra.is_verified)
        self.db.add.assert_not_called()

    async def test_new_address_is_added_only_after_google_confirmation(self):
        await self.call('personal@gmail.com')
        added = self.db.add.call_args.args[0]
        self.assertIsInstance(added, UserEmail)
        self.assertTrue(added.is_verified)
        self.assertEqual(added.email, 'personal@gmail.com')

    async def test_another_users_email_cannot_be_claimed(self):
        with self.assertRaises(HTTPException) as ctx:
            await self.call('occupied@gmail.com', occupied=True)
        self.assertEqual(ctx.exception.status_code, 409)
        self.db.add.assert_not_called()
        self.db.commit.assert_not_awaited()

    async def test_unverified_google_token_cannot_change_anything(self):
        with self.assertRaises(HTTPException) as ctx:
            await self.call(verified=False)
        self.assertEqual(ctx.exception.status_code, 401)
        self.db.add.assert_not_called()
        self.db.commit.assert_not_awaited()
