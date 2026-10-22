"""Isolated PostgreSQL + real loopback SMTP acceptance test for tasks 5–7.

Run: ../.venv/bin/python tests/e2e_access_meet.py (from backend/).
Creates and removes a uniquely named LOCAL database. No production data, email
recipients, Google accounts or real meetings are used. Google proof and the bot
provider are simulated (Meet and external Zoom OBF); HTTP handlers, database, SMTP transport, reset tokens,
review/publication and student access checks are real.
"""
from __future__ import annotations

import asyncio
import os
import re
import socketserver
import sys
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.parse import urlsplit, urlunsplit

import asyncpg
from starlette.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
admin_url = os.environ.get('ACCESS_SMOKE_PG_ADMIN_URL', 'postgresql://127.0.0.1/postgres')
parts = urlsplit(admin_url)
if parts.hostname not in {'localhost', '127.0.0.1', '::1'}:
    raise SystemExit('This test only accepts a local PostgreSQL server.')
database_name = 'tte_access_meet_' + uuid.uuid4().hex[:12]
db_url = urlunsplit((parts.scheme, parts.netloc, '/' + database_name, parts.query, ''))
os.environ.update({
    'DATABASE_URL': db_url.replace('postgresql://', 'postgresql+asyncpg://'),
    'ENVIRONMENT': 'development', 'REDIS_URL': 'redis://127.0.0.1:6379/14',
    'JWT_SECRET_KEY': 'isolated-access-meet-test-' + uuid.uuid4().hex,
    'PGCRYPTO_KEY': 'isolated-access-meet-test-' + uuid.uuid4().hex,
    'FRONTEND_URL': 'http://localhost:5173', 'PUBLIC_API_BASE_URL': 'http://localhost:8000',
    'MEETING_BOT_ENABLED': 'true', 'MEETING_BOT_PROVIDER': 'mock', 'ZOOM_BOT_MODE': 'off',
    'ENABLE_AGREEMENT_GATE': 'false', 'GOOGLE_OAUTH_CLIENT_ID': 'isolated-google-client',
    'SMTP_HOST': '127.0.0.1', 'SMTP_FROM': 'noreply@example.test', 'SMTP_USERNAME': '',
    'SMTP_PASSWORD': '', 'SMTP_USE_SSL': 'false', 'SMTP_STARTTLS': 'false',
    **{key: '' for key in [
        'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_URL', 'NOTION_API_KEY',
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY', 'SENTRY_DSN',
        'ATTENDEE_API_KEY', 'ATTENDEE_API_URL', 'GOOGLE_SERVICE_ACCOUNT_JSON',
        'GOOGLE_SERVICE_ACCOUNT_FILE', 'GOOGLE_AUTHORIZED_USER_JSON',
    ]},
})

from app.core.config import settings
from app.core.database import AsyncSessionLocal, Base, engine
from app.core.security import hash_password
from app.main import app as api_app
import app.models  # register the entire schema
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole
from app.models.note_session import NoteSession
from app.models.student_invite import StudentInvite
from app.services.invites import _hash_token
from app.api.v1.endpoints import auth, note_sessions
from app.services import note_session_finalize, rate_limit
from app.services.google_auth import GoogleIdentity
from app.services.meeting_bot import service
from app.services.meeting_bot.mock import MOCK_SCRIPT, MockProvider
from app.services.meeting_bot.attendee import build_create_payload


class SmtpHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'220 localhost test SMTP\r\n')
        while line := self.rfile.readline():
            verb = line.split(b' ', 1)[0].strip().upper()
            if verb in {b'EHLO', b'HELO'}:
                self.wfile.write(b'250 localhost\r\n')
            elif verb == b'DATA':
                self.wfile.write(b'354 End with a dot\r\n')
                data = bytearray()
                while (chunk := self.rfile.readline()) not in {b'.\r\n', b''}:
                    data.extend(chunk[1:] if chunk.startswith(b'..') else chunk)
                self.server.messages.append(BytesParser(policy=policy.default).parsebytes(bytes(data)))
                self.wfile.write(b'250 queued locally\r\n')
            elif verb == b'QUIT':
                self.wfile.write(b'221 bye\r\n')
                return
            else:
                self.wfile.write(b'250 OK\r\n')


def require(ok, label, response=None):
    if not ok:
        detail = f' HTTP {response.status_code}: {response.text[:300]}' if response is not None else ''
        raise AssertionError(label + detail)
    print('PASS', label, flush=True)


async def create_database():
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f'CREATE DATABASE "{database_name}"')
    finally:
        await conn.close()


async def seed():
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS pgcrypto'))
        await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as db:
        users = {}
        for role in [UserRole.admin, UserRole.mentor, UserRole.student]:
            user = User(name='Acceptance ' + role.value, email=role.value + '@example.test',
                        hashed_password=hash_password('OriginalPassword2026!'), role=role,
                        is_active=True, must_change_password=False)
            if role == UserRole.admin:
                user.zoom_user_id = 'connected-participant-not-host'
                user.zoom_connection_state = 'connected'
            db.add(user)
            await db.flush()
            users[role.value] = user.id
        outsider = User(name='Other student', email='other@example.test',
                        hashed_password=hash_password('OriginalPassword2026!'), role=UserRole.student,
                        is_active=True, must_change_password=False)
        db.add(outsider)
        await db.flush()
        student = Student(full_name='Acceptance Student', phone='+77000000001',
                          degree_level=DegreeLevel.undergraduate, intake_year=2027, user_id=users['student'])
        other = Student(full_name='Other Student', phone='+77000000002',
                        degree_level=DegreeLevel.undergraduate, intake_year=2027, user_id=outsider.id)
        db.add_all([student, other])
        await db.commit()
        ids = {**users, 'student_card': str(student.id)}
    await engine.dispose()
    return ids


def google_proof(credential):
    return GoogleIdentity(email=credential, email_verified=True, name='Acceptance', subject='fake-subject')


async def bot_id_for(session_id):
    async with AsyncSessionLocal() as db:
        session = await db.get(NoteSession, uuid.UUID(session_id))
        return session.bot_external_id


async def expire_link(raw_token):
    from sqlalchemy import update
    async with AsyncSessionLocal() as db:
        await db.execute(update(StudentInvite).where(StudentInvite.token_hash == _hash_token(raw_token))
                         .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        await db.commit()


def letter_token(letter):
    text = letter.get_body(preferencelist=('plain',)).get_content()
    return re.search(r'/invite/([A-Za-z0-9_-]+)\?reset=1', text).group(1)


def run(client, smtp, ids):
    def call(method, path, *, token=None, body=None):
        headers = {'Authorization': 'Bearer ' + token} if token else {}
        return client.request(method, '/api/v1' + path, headers=headers, json=body)

    def login(email, password='OriginalPassword2026!'):
        response = call('POST', '/auth/login', body={'email': email, 'password': password})
        require(response.status_code == 200, 'login ' + email.split('@')[0], response)
        return response.json()['access_token']

    admin_token = login('admin@example.test')
    for role in ['mentor', 'student']:
        token = login(role + '@example.test')
        before = len(smtp.messages)
        requested = call('POST', '/auth/password-reset', body={'email': role + '@example.test'})
        require(requested.status_code == 200 and len(smtp.messages) == before + 1,
                role + ' registration email receives reset without Google', requested)
        require(str(smtp.messages[-1]['To']) == role + '@example.test', role + ' primary-only recipient correct')
        superseded_token = letter_token(smtp.messages[-1])
        primary = call('POST', '/auth/google/link', token=token, body={'credential': role + '@example.test'})
        require(primary.status_code == 200 and primary.json()['google_account']['linked'], role + ' primary Google confirmed', primary)
        require(primary.json()['extras'] == [], role + ' primary does not consume extra address slot')
        extra = role + '-google@example.test'
        linked = call('POST', '/auth/google/link', token=token, body={'credential': extra})
        require(linked.status_code == 200 and extra in linked.json()['google_account']['emails'], role + ' extra Google linked', linked)
        google_login = call('POST', '/auth/google', body={'credential': extra})
        require(google_login.status_code == 200 and google_login.json()['user']['id'] == str(ids[role]), role + ' Google enters the same account', google_login)
        old_token = google_login.json()['access_token']
        old_refresh = client.cookies.get('refresh_token')
        before = len(smtp.messages)
        requested = call('POST', '/auth/password-reset', body={'email': extra})
        require(requested.status_code == 200 and len(smtp.messages) == before + 2, role + ' reset delivered through SMTP to both addresses', requested)
        letters = smtp.messages[before:]
        require({str(m['To']) for m in letters} == {role + '@example.test', extra}, role + ' recipients are correct')
        require(call('POST', '/public/invite/' + superseded_token + '/accept',
                     body={'password': 'SupersededPassword2026!'}).status_code == 410,
                role + ' new reset invalidates the previous unused link')
        raw = letter_token(letters[0])
        accepted = call('POST', '/public/invite/' + raw + '/accept', body={'password': 'NewPassword2026!'})
        require(accepted.status_code == 200, role + ' link sets new password', accepted)
        replay = call('POST', '/public/invite/' + raw + '/accept', body={'password': 'AnotherPassword2026!'})
        require(replay.status_code == 410, role + ' used link cannot be replayed', replay)
        require(call('GET', '/auth/me', token=old_token).status_code == 401, role + ' reset revokes previous sessions')
        refreshed = client.post('/api/v1/auth/refresh', headers={'Cookie': 'refresh_token=' + old_refresh})
        require(refreshed.status_code == 401, role + ' old refresh token cannot restore session', refreshed)
        require(call('GET', '/auth/me', token=accepted.json()['access_token']).status_code == 200,
                role + ' new session works immediately after reset')
        require(call('POST', '/auth/login', body={'email': role + '@example.test', 'password': 'OriginalPassword2026!'}).status_code == 401, role + ' old password rejected')
        login(role + '@example.test', 'NewPassword2026!')

    collision = call('POST', '/auth/google/link', token=admin_token, body={'credential': 'student-google@example.test'})
    require(collision.status_code == 409, 'Google address cannot be linked to another account', collision)
    users = call('GET', '/users', token=admin_token)
    require(users.status_code == 200, 'admin Google confirmation report loads', users)
    confirmed = [u for u in users.json() if u['google_account']['linked']]
    require(len(confirmed) == 2, 'admin report includes staff and student Google confirmations')

    require(call('POST', '/auth/password-reset', body={'email': 'mentor@example.test'}).status_code == 200,
            'expiry test requests reset')
    expired = letter_token(smtp.messages[-1])
    client.portal.call(expire_link, expired)
    require(call('POST', '/public/invite/' + expired + '/accept', body={'password': 'ExpiredPassword2026!'}).status_code == 410,
            'expired reset cannot change password')
    require(call('POST', '/auth/password-reset', body={'email': 'mentor@example.test'}).status_code == 200,
            'concurrent test requests reset')
    concurrent = letter_token(smtp.messages[-1])
    barrier = threading.Barrier(2)
    def consume_once(_):
        barrier.wait(timeout=5)
        return call('POST', '/public/invite/' + concurrent + '/accept', body={'password': 'NewPassword2026!'}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(consume_once, range(2)))
    require(sorted(results) == [200, 410], 'concurrent reset is accepted exactly once')

    student_token = login('student@example.test', 'NewPassword2026!')
    other_token = login('other@example.test')
    for platform, meeting_url in [('meet', 'https://meet.google.com/abc-defg-hij'),
                                  ('zoom', 'https://us02web.zoom.us/j/12345678901?pwd=test-password')]:
        provider = MockProvider()
        provider.create_bot = mock.AsyncMock(wraps=provider.create_bot)
        with mock.patch.object(settings, 'ZOOM_BOT_MODE', 'obf'), \
             mock.patch.object(service, 'get_provider', return_value=provider):
            starts = datetime.now(timezone.utc) + timedelta(minutes=5)
            meeting = call('POST', '/meetings', token=admin_token, body={
                'student_id': ids['student_card'], 'title': 'Acceptance ' + platform, 'meeting_type': 'regular',
                'meeting_link': meeting_url, 'starts_at': starts.isoformat(),
                'ends_at': (starts + timedelta(minutes=30)).isoformat(),
            })
            require(meeting.status_code == 201, platform + 'meeting meeting created', meeting)
            session = call('POST', '/note-sessions', token=admin_token, body={
                'student_id': ids['student_card'], 'meeting_id': meeting.json()['id'], 'title': 'Acceptance ' + platform, 'source': 'meeting',
            })
            require(session.status_code == 201, platform + 'meeting note session created', session)
            session_id = session.json()['id']
            creation_url = call('POST', '/note-sessions/' + session_id + '/bot', token=admin_token, body={'meeting_url': 'https://meet.google.com/new', 'language': 'ru'})
            require(creation_url.status_code == 422, 'Meet creation page rejected as a room', creation_url)
            sent = call('POST', '/note-sessions/' + session_id + '/bot', token=admin_token, body={'meeting_url': meeting_url, 'language': 'ru'})
            require(sent.status_code == 200 and sent.json()['bot_status'] == 'joining', platform + 'meeting bot sent through API (simulated provider)', sent)
            request = provider.create_bot.await_args.args[0]
            require(request.meeting_url == meeting_url, platform + ' original meeting link preserved')
            if platform == 'zoom':
                payload = build_create_payload(request)
                require(payload['zoom_settings']['onbehalf_token']['zoom_oauth_connection_user_id'] == 'connected-participant-not-host',
                        'external Zoom uses connected participant, without requiring host identity')
            external_id = client.portal.call(bot_id_for, session_id)
            for index, (_, event) in enumerate(MOCK_SCRIPT):
                payload = {**event, 'bot_id': external_id, 'idempotency_key': platform + '-acceptance-' + str(index)}
                response = client.post('/api/v1/webhooks/meeting-bot/mock', json=payload, headers={'X-Webhook-Signature': 'mock'})
                require(response.status_code == 200, platform + 'meeting webhook ' + str(index), response)
            client.portal.call(service.finalize_bot_session, uuid.UUID(session_id))
            detail = call('GET', '/note-sessions/' + session_id, token=admin_token)
            require(detail.status_code == 200 and detail.json()['bot_status'] == 'done' and detail.json()['note_id'], platform + 'meeting transcript produces note draft', detail)
            note_id = detail.json()['note_id']
            require(call('GET', '/portal/notes/' + note_id, token=student_token).status_code == 404, 'student cannot see draft')
            require(call('POST', '/notes/' + note_id + '/publish', token=admin_token, body={}).status_code == 409, 'draft cannot be published before review')
            reviewed = call('POST', '/notes/' + note_id + '/review', token=admin_token, body={'action': 'approve', 'suggested_changes': {}})
            require(reviewed.status_code == 200, platform + 'meeting note reviewed', reviewed)
            require(call('GET', '/portal/notes/' + note_id, token=student_token).status_code == 404, 'approval alone does not expose note')
            published = call('POST', '/notes/' + note_id + '/publish', token=admin_token, body={})
            require(published.status_code == 200, platform + 'meeting note published', published)
            visible = call('GET', '/portal/notes/' + note_id, token=student_token)
            require(visible.status_code == 200, platform + 'own student sees published meeting note', visible)
            require(call('GET', '/portal/notes/' + note_id, token=other_token).status_code == 404, 'another student cannot see published note')


async def drop_database():
    await engine.dispose()
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f'DROP DATABASE "{database_name}" WITH (FORCE)')
    finally:
        await conn.close()


def main():
    smtp = socketserver.ThreadingTCPServer(('127.0.0.1', 0), SmtpHandler)
    smtp.messages = []
    smtp.daemon_threads = True
    settings.SMTP_PORT = smtp.server_address[1]
    thread = threading.Thread(target=smtp.serve_forever, daemon=True)
    thread.start()
    created = False
    try:
        asyncio.run(create_database())
        created = True
        ids = asyncio.run(seed())
        queue = SimpleNamespace(enqueue_job=mock.AsyncMock())
        draft = {'title': 'Acceptance Meet', 'summary_markdown': 'Mentor: prepare IELTS and a shortlist.',
                 'student_summary_markdown': 'Подготовьте IELTS и список университетов.', 'suggested_changes': {}}
        with mock.patch.object(auth, 'verify_google_id_token', google_proof), \
             mock.patch.object(rate_limit, 'enforce', mock.AsyncMock()), \
             mock.patch.object(rate_limit, 'reset', mock.AsyncMock()), \
             mock.patch.object(note_sessions, 'get_arq_pool', mock.AsyncMock(return_value=queue)), \
             mock.patch.object(note_session_finalize, 'generate_note_draft', mock.AsyncMock(return_value=draft)), \
             TestClient(api_app) as client:
            try:
                run(client, smtp, ids)
            finally:
                client.portal.call(engine.dispose)
        print('PASS isolated access + SMTP + Meet + external Zoom acceptance flow', flush=True)
    finally:
        smtp.shutdown()
        smtp.server_close()
        if created:
            asyncio.run(drop_database())


if __name__ == '__main__':
    main()
