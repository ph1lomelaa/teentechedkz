import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, mock

from fastapi import HTTPException
from app.api.v1.endpoints import note_sessions
from app.models.note_session import NoteSessionStatus


class DriveImportEndpointTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.sid=uuid.uuid4()
        self.user=SimpleNamespace(id=uuid.uuid4())
        self.session=SimpleNamespace(id=self.sid, bot_last_event_at=datetime.now(timezone.utc), bot_status='downloading', bot_status_reason=None, status=NoteSessionStatus.active)
        self.db=mock.Mock(commit=mock.AsyncMock())
        self.context=mock.patch.object(note_sessions, '_session_context', new=mock.AsyncMock(return_value=(self.session,'Demo'))).start()
        self.claim=mock.patch.object(note_sessions, '_claim_recording_import', new=mock.AsyncMock()).start()
        self.pool=mock.Mock(setex=mock.AsyncMock(),enqueue_job=mock.AsyncMock(return_value=object()))
        self.queue=mock.patch.object(note_sessions, 'get_arq_pool', new=mock.AsyncMock(return_value=self.pool)).start()
        self.response=mock.patch.object(note_sessions, '_session_response', return_value={'accepted':True}).start()
        self.addCleanup(mock.patch.stopall)

    async def call(self, url='https://drive.google.com/file/d/testRecording12345/view', language='ru'):
        return await note_sessions.import_drive(self.sid,note_sessions.DriveImportRequest(url=url,language=language),self.user,self.db)

    async def test_access_checked_before_claim_or_download(self):
        self.context.side_effect=HTTPException(status_code=403,detail='Access denied')
        with self.assertRaises(HTTPException) as error: await self.call()
        self.assertEqual(error.exception.status_code,403)
        self.claim.assert_not_awaited(); self.queue.assert_not_awaited()

    async def test_invalid_link_or_language_does_not_start_import(self):
        for url,language in [('https://evil.test/recording','ru'),('https://drive.google.com/file/d/testRecording12345/view','de')]:
            with self.assertRaises(HTTPException) as error: await self.call(url,language)
            self.assertEqual(error.exception.status_code,422)
        self.claim.assert_not_awaited(); self.queue.assert_not_awaited()

    async def test_request_queues_only_after_atomic_claim(self):
        result=await self.call()
        self.assertTrue(result['accepted'])
        self.claim.assert_awaited_once_with(self.db,self.session,language='ru',stage='downloading')
        self.assertEqual(self.pool.enqueue_job.await_args.args,('import_drive_recording_task',str(self.sid),self.session.bot_last_event_at.isoformat()))
        self.assertIn('testRecording12345',self.pool.setex.await_args.args[2])

    async def test_duplicate_claim_does_not_enqueue(self):
        self.claim.side_effect=HTTPException(status_code=409,detail='Busy')
        with self.assertRaises(HTTPException) as error: await self.call()
        self.assertEqual(error.exception.status_code,409)
        self.queue.assert_not_awaited()

    async def test_queue_failure_leaves_retryable_state(self):
        self.pool.enqueue_job.side_effect=ConnectionError('redis unavailable')
        with self.assertRaises(HTTPException) as error: await self.call()
        self.assertEqual(error.exception.status_code,503)
        self.assertEqual(self.session.status,NoteSessionStatus.failed)
        self.assertEqual(self.session.bot_status_reason,'recording_queue_unavailable')
        self.db.commit.assert_awaited_once()
