"""Recent rotations across multiple tabs must remain usable; revoked sessions must not."""
import asyncio
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Response
from app.api.v1.endpoints.auth import refresh
from app.models.user import RefreshToken, User, UserRole


class Result:
    def __init__(self, value): self.value = value
    def scalar_one_or_none(self): return self.value


class Session:
    def __init__(self, answers):
        self.answers = iter(answers)
        self.statements = []
        self.added = []
        self.committed = False
    async def execute(self, statement):
        self.statements.append(statement)
        return Result(next(self.answers))
    def add(self, value): self.added.append(value)
    async def commit(self): self.committed = True


def token(*, revoked=False, age=0, replacement=None):
    return RefreshToken(user_id=uuid.uuid4(), token_hash=uuid.uuid4().hex,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        revoked=revoked, replaced_by_hash=replacement,
        revoked_at=datetime.now(timezone.utc) - timedelta(seconds=age) if revoked else None)


class RefreshRotationTests(unittest.TestCase):
    def test_follows_multiple_recent_rotations_and_locks_every_token(self):
        latest = token()
        middle = token(revoked=True, replacement=latest.token_hash)
        old = token(revoked=True, replacement=middle.token_hash)
        user = User(id=latest.user_id, role=UserRole.mentor)
        session = Session([old, middle, latest, user])
        response = Response()
        result = asyncio.run(refresh(response, session, 'original-cookie'))
        self.assertTrue(result['access_token'])
        self.assertIn('refresh_token=', response.headers['set-cookie'])
        self.assertTrue(session.committed)
        self.assertEqual(len(session.added), 1)
        for statement in session.statements[:3]:
            self.assertIsNotNone(statement._for_update_arg)
        self.assertTrue(latest.revoked)
        self.assertEqual(latest.replaced_by_hash, session.added[0].token_hash)

    def test_revoked_without_replacement_stays_revoked(self):
        session = Session([token(revoked=True)])
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(refresh(Response(), session, 'revoked-cookie'))
        self.assertEqual(caught.exception.status_code, 401)
        self.assertFalse(session.committed)
        self.assertFalse(session.added)

    def test_old_rotated_cookie_outside_grace_is_rejected(self):
        session = Session([token(revoked=True, age=120, replacement='next')])
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(refresh(Response(), session, 'old-cookie'))
        self.assertEqual(caught.exception.status_code, 401)
        self.assertFalse(session.added)
