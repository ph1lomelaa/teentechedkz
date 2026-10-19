import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, mock

from app.services import drive_recording
from app.models.note_session import NoteSessionStatus


class DriveWorkerTests(IsolatedAsyncioTestCase):
    def setUp(self):
        self.when=datetime.now(timezone.utc)
        self.session=SimpleNamespace(id=uuid.uuid4(),note_id=None,status=NoteSessionStatus.active,bot_status='downloading',bot_last_event_at=self.when,audio_storage_path=None)
        self.db=mock.Mock(get=mock.AsyncMock(return_value=self.session),commit=mock.AsyncMock())
        @asynccontextmanager
        async def database(): yield self.db
        mock.patch('app.core.database.AsyncSessionLocal',database).start()
        self.download=mock.patch.object(drive_recording,'download_drive_recording',new=mock.AsyncMock(return_value=(b'audio','test.wav','audio/wav'))).start()
        self.store=mock.patch('app.services.minio_service.minio_upload_note_audio',new=mock.AsyncMock(return_value='stored/audio')).start()
        self.process=mock.patch('app.services.note_upload.process_uploaded_audio',new=mock.AsyncMock(return_value='ok')).start()
        self.push=mock.patch('app.services.meeting_bot.service._push_status',new=mock.AsyncMock()).start()
        mock.patch('app.services.meeting_bot.service._notify_failed',new=mock.AsyncMock()).start()
        self.addCleanup(mock.patch.stopall)

    async def run_import(self, attempt=None):
        return await drive_recording.import_drive_recording(str(self.session.id),'testRecording12345',None,attempt or self.when.isoformat())

    async def test_stale_job_does_not_download_or_overwrite_new_attempt(self):
        result=await self.run_import((self.when-timedelta(minutes=1)).isoformat())
        self.assertEqual(result,'skipped'); self.download.assert_not_awaited()

    async def test_cancelled_during_download_does_not_store_or_transcribe(self):
        async def cancel(_):
            self.session.status=NoteSessionStatus.cancelled
            return b'audio','test.wav','audio/wav'
        self.download.side_effect=cancel
        self.assertEqual(await self.run_import(),'skipped')
        self.store.assert_not_awaited(); self.process.assert_not_awaited()

    async def test_failed_old_attempt_cannot_mark_new_attempt_failed(self):
        async def replaced(_):
            self.session.bot_last_event_at=self.when+timedelta(minutes=1)
            raise drive_recording.DriveRecordingError('drive_timeout')
        self.download.side_effect=replaced
        await self.run_import()
        self.assertEqual(self.session.bot_status,'downloading')
        self.assertEqual(self.session.status,NoteSessionStatus.active)
        self.db.commit.assert_not_awaited()

    async def test_success_persists_media_and_starts_existing_transcription(self):
        self.assertEqual(await self.run_import(),'ok')
        self.assertEqual(self.session.audio_storage_path,'stored/audio')
        self.assertEqual(self.session.bot_status,'transcribing')
        self.process.assert_awaited_once_with(self.session.id,'audio/wav')
