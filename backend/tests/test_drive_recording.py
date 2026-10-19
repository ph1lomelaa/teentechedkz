import io
import unittest
import wave
from unittest.mock import patch

import httpx

from app.services.drive_recording import (
    DriveFile, DriveRecordingError, confirmation_url, download_drive_recording,
    parse_drive_link,
)

FILE_ID = 'abc123def456ghi789'
LINK = f'https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing&resourcekey=0-resourcekey123'


def audio():
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000)
        wav.writeframes(b'\x00\x01' * 8000)
    return out.getvalue()


class DriveLinkTests(unittest.TestCase):
    def test_share_open_and_uc_links_preserve_resource_key(self):
        self.assertEqual(parse_drive_link(LINK), DriveFile(FILE_ID, '0-resourcekey123'))
        for value in [f'https://drive.google.com/open?id={FILE_ID}', f'https://drive.google.com/uc?export=download&id={FILE_ID}']:
            self.assertEqual(parse_drive_link(value).file_id, FILE_ID)
        self.assertIn('resourcekey=0-resourcekey123', parse_drive_link(LINK).download_url())

    def test_folders_and_untrusted_urls_rejected(self):
        for value, code in [(f'https://drive.google.com/drive/folders/{FILE_ID}', 'drive_folder'), ('https://127.0.0.1/file/d/'+FILE_ID, 'drive_invalid_link'), ('https://drive.google.com.evil.test/file/d/'+FILE_ID, 'drive_invalid_link'), ('https://user@drive.google.com/file/d/'+FILE_ID, 'drive_invalid_link'), ('http://drive.google.com/file/d/'+FILE_ID, 'drive_invalid_link'), ('https://drive.google.com:8080/file/d/'+FILE_ID, 'drive_invalid_link')]:
            with self.subTest(value=value), self.assertRaises(DriveRecordingError) as error:
                parse_drive_link(value)
            self.assertEqual(error.exception.code, code)

    def test_confirmation_cannot_change_file_id_or_host(self):
        for action, file_id in [('https://127.0.0.1/download', FILE_ID), ('https://drive.usercontent.google.com/download', 'anotherfile123')]:
            with self.assertRaises(DriveRecordingError):
                confirmation_url(f'<form id="download-form" action="{action}"><input name="id" value="{file_id}"></form>', LINK, DriveFile(FILE_ID))


class DriveDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_redirect_confirmation_and_media_download(self):
        requests = []
        def handler(request):
            requests.append(request)
            if len(requests) == 1:
                return httpx.Response(302, headers={'location': f'https://drive.usercontent.google.com/download?id={FILE_ID}'})
            if len(requests) == 2:
                return httpx.Response(200, headers={'content-type': 'text/html'}, text=f'<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input name="id" value="{FILE_ID}"><input name="confirm" value="t"><input name="uuid" value="test"></form>')
            self.assertEqual(request.url.params['resourcekey'], '0-resourcekey123')
            return httpx.Response(200, headers={'content-type': 'audio/wav', 'content-disposition': "attachment; filename*=UTF-8''meeting%20recording.wav"}, content=audio())
        content, name, mime = await download_drive_recording(parse_drive_link(LINK), transport=httpx.MockTransport(handler))
        self.assertEqual(content, audio()); self.assertEqual(name, 'meeting recording.wav')
        self.assertTrue(mime.startswith('audio/')); self.assertEqual(len(requests), 3)

    async def test_redirect_to_private_host_never_requested(self):
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(302, headers={'location': 'http://169.254.169.254/latest/meta-data/'})
        with self.assertRaises(DriveRecordingError):
            await download_drive_recording(DriveFile(FILE_ID), transport=httpx.MockTransport(handler))
        self.assertEqual(len(requests), 1)

    async def test_closed_missing_quota_empty_and_renamed_pdf(self):
        cases = [(httpx.Response(403), 'drive_access_denied'), (httpx.Response(404), 'drive_access_denied'), (httpx.Response(429), 'drive_quota'), (httpx.Response(200, content=b''), 'drive_empty'), (httpx.Response(200, headers={'content-type':'text/html'}, text='<html>Sign in</html>'), 'drive_access_denied'), (httpx.Response(200, headers={'content-type':'audio/mpeg', 'content-disposition':'attachment; filename="recording.mp3"'}, content=b'%PDF-1.4\n%not audio'), 'drive_not_media')]
        for response, code in cases:
            with self.subTest(code=code), self.assertRaises(DriveRecordingError) as error:
                await download_drive_recording(DriveFile(FILE_ID), transport=httpx.MockTransport(lambda _: response))
            self.assertEqual(error.exception.code, code)

    async def test_size_limit_with_and_without_content_length(self):
        with patch('app.services.drive_recording.MAX_UPLOAD_BYTES', 32):
            for headers in [{'content-length':'100', 'content-type':'audio/wav'}, {'content-type':'audio/wav', 'transfer-encoding':'chunked'}]:
                with self.assertRaises(DriveRecordingError) as error:
                    await download_drive_recording(DriveFile(FILE_ID), transport=httpx.MockTransport(lambda _: httpx.Response(200, headers=headers, content=b'X'*100)))
                self.assertEqual(error.exception.code, 'drive_too_large')

    async def test_timeout_is_actionable(self):
        def handler(request): raise httpx.ReadTimeout('timeout')
        with self.assertRaises(DriveRecordingError) as error:
            await download_drive_recording(DriveFile(FILE_ID), transport=httpx.MockTransport(handler))
        self.assertEqual(error.exception.code, 'drive_timeout')
