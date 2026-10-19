"""Bounded anonymous download of a link-shared Google Drive media file.

Never fetch the supplied URL directly. Extract its file ID, build a Google
endpoint and validate every redirect/confirmation form before following it.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from email.message import Message
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urljoin, urlsplit

import httpx

from app.services.note_upload import MAX_UPLOAD_BYTES, guess_mime, is_allowed_audio

TOKEN = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
MAX_HTML_BYTES = 1024 * 1024


class DriveRecordingError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class DriveFile:
    file_id: str
    resource_key: str | None = None

    def download_url(self) -> str:
        params = {"export": "download", "id": self.file_id}
        if self.resource_key:
            params["resourcekey"] = self.resource_key
        return "https://drive.google.com/uc?" + urlencode(params)


def parse_drive_link(value: str) -> DriveFile:
    if len(value) > 4096:
        raise DriveRecordingError("drive_invalid_link")
    try:
        url = urlsplit(value.strip())
        if url.scheme != "https" or url.hostname != "drive.google.com" or url.username or url.password or url.port not in (None, 443):
            raise ValueError()
        if "/folders/" in url.path:
            raise DriveRecordingError("drive_folder")
        query = parse_qs(url.query)
        match = re.fullmatch(r"/file/d/([A-Za-z0-9_-]+)(?:/(?:view|preview|edit))?/?", url.path)
        file_id = match[1] if match else query.get("id", [""])[0] if url.path in ("/open", "/uc", "/download") else ""
        key = query.get("resourcekey", [None])[0]
        if not TOKEN.fullmatch(file_id) or (key and not TOKEN.fullmatch(key)):
            raise ValueError()
        return DriveFile(file_id, key)
    except DriveRecordingError:
        raise
    except (ValueError, TypeError):
        raise DriveRecordingError("drive_invalid_link") from None


def safe_download_url(value: str) -> str:
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        allowed = host in ("drive.google.com", "drive.usercontent.google.com") or bool(re.fullmatch(r"doc-[a-z0-9-]+-docs\.googleusercontent\.com", host))
        if url.scheme != "https" or not allowed or url.username or url.password or url.port not in (None, 443):
            raise ValueError()
        return value
    except ValueError:
        raise DriveRecordingError("drive_access_denied") from None


class DownloadForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action: str | None = None
        self.fields: dict[str, str] = {}
        self.inside = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form" and attrs.get("id") == "download-form" and attrs.get("method", "get").lower() == "get":
            self.inside = True
            self.action = attrs.get("action")
        elif tag == "input" and self.inside and attrs.get("name") in ("id", "export", "confirm", "uuid", "at", "resourcekey"):
            self.fields[attrs["name"]] = attrs.get("value", "")

    def handle_endtag(self, tag):
        if tag == "form":
            self.inside = False


def confirmation_url(html: str, base: str, file: DriveFile) -> str:
    form = DownloadForm()
    form.feed(html)
    if not form.action or form.fields.get("id") != file.file_id:
        if "downloadQuotaExceeded" in html or "Too many users" in html:
            raise DriveRecordingError("drive_quota")
        raise DriveRecordingError("drive_access_denied")
    target = safe_download_url(urljoin(base, form.action))
    if urlsplit(target).path not in ("/download", "/uc"):
        raise DriveRecordingError("drive_access_denied")
    if file.resource_key:
        form.fields["resourcekey"] = file.resource_key
    return target.split("?", 1)[0] + "?" + urlencode(form.fields)


async def download_drive_recording(file: DriveFile, *, transport=None) -> tuple[bytes, str, str]:
    try:
        # Total deadline also bounds servers that drip bytes below read timeout.
        async with asyncio.timeout(600):
            async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=15), follow_redirects=False, transport=transport, trust_env=False) as client:
                target = file.download_url()
                confirmations = 0
                for _ in range(8):
                    safe_download_url(target)
                    async with client.stream("GET", target, headers={"Accept-Encoding": "identity"}) as response:
                        if response.status_code in (301, 302, 303, 307, 308):
                            target = safe_download_url(urljoin(target, response.headers.get("location", "")))
                            continue
                        if response.status_code == 429:
                            raise DriveRecordingError("drive_quota")
                        if response.status_code in (401, 403, 404):
                            raise DriveRecordingError("drive_access_denied")
                        if response.status_code != 200:
                            raise DriveRecordingError("drive_download_failed")
                        mime = response.headers.get("content-type", "application/octet-stream").split(";", 1)[0].lower()
                        html_response = mime in ("text/html", "application/xhtml+xml")
                        limit = MAX_HTML_BYTES if html_response else MAX_UPLOAD_BYTES
                        length = response.headers.get("content-length", "")
                        if length.isdigit() and int(length) > limit:
                            raise DriveRecordingError("drive_access_denied" if html_response else "drive_too_large")
                        content = bytearray()
                        async for chunk in response.aiter_bytes(64 * 1024):
                            content.extend(chunk)
                            if len(content) > limit:
                                raise DriveRecordingError("drive_access_denied" if html_response else "drive_too_large")
                        if html_response:
                            if confirmations >= 1:
                                raise DriveRecordingError("drive_access_denied")
                            target = confirmation_url(content.decode("utf-8", errors="replace"), target, file)
                            confirmations += 1
                            continue
                        if not content:
                            raise DriveRecordingError("drive_empty")
                        header = Message()
                        header["content-disposition"] = response.headers.get("content-disposition", "")
                        filename = (header.get_filename() or "drive-recording").replace("\\", "/").rsplit("/", 1)[-1][:240]
                        # Reject HTML/error pages and renamed documents, even with an audio suffix.
                        import magic
                        detected = magic.from_buffer(bytes(content[:8192]), mime=True)
                        if detected.startswith(("text/", "image/")) or detected in ("application/pdf", "application/zip"):
                            raise DriveRecordingError("drive_not_media")
                        if not is_allowed_audio(filename, mime) and not is_allowed_audio(filename, detected):
                            raise DriveRecordingError("drive_not_media")
                        return bytes(content), filename, guess_mime(filename, detected if detected.startswith(("audio/", "video/")) else mime)
                raise DriveRecordingError("drive_download_failed")
    except DriveRecordingError:
        raise
    except (TimeoutError, httpx.TimeoutException):
        raise DriveRecordingError("drive_timeout") from None
    except httpx.HTTPError:
        raise DriveRecordingError("drive_download_failed") from None


async def import_drive_recording(session_id: str, file_id: str, resource_key: str | None, attempt: str) -> str:
    """Redis job; closing the browser does not interrupt download or STT."""
    import logging
    import uuid
    from datetime import datetime, timezone
    from app.core.database import AsyncSessionLocal
    from app.models.note_session import NoteSession, NoteSessionStatus
    from app.services.minio_service import minio_upload_note_audio, minio_delete
    from app.services.note_upload import process_uploaded_audio
    from app.services.meeting_bot.service import _notify_failed, _push_status

    async def current(db):
        session = await db.get(NoteSession, uuid.UUID(session_id), populate_existing=True)
        if not session or session.note_id or session.status != NoteSessionStatus.active or session.bot_status != "downloading" or not session.bot_last_event_at or session.bot_last_event_at.isoformat() != attempt:
            return None
        return session

    failure_attempt = attempt
    try:
        async with AsyncSessionLocal() as db:
            if not await current(db):
                return "skipped"
        content, filename, mime = await download_drive_recording(DriveFile(file_id, resource_key))
        async with AsyncSessionLocal() as db:
            session = await current(db)
            if not session:
                return "skipped"
            previous_path = session.audio_storage_path
            stored = await minio_upload_note_audio(content=content, session_id=session.id, filename=filename, mime_type=mime)
            session.audio_storage_path = stored
            session.bot_status = "transcribing"
            session.bot_last_event_at = datetime.now(timezone.utc)
            failure_attempt = session.bot_last_event_at.isoformat()
            try:
                await db.commit()
            except Exception:
                await minio_delete(stored)
                raise
            if previous_path and previous_path != stored:
                try:
                    await minio_delete(previous_path)
                except Exception:
                    logging.getLogger(__name__).warning("Could not clean previous recording for %s", session.id)
            await _push_status(session)
        return await process_uploaded_audio(uuid.UUID(session_id), mime)
    except Exception as exc:
        code = exc.code if isinstance(exc, DriveRecordingError) else "drive_download_failed"
        logging.getLogger(__name__).warning("Drive import failed for session %s (%s)", session_id, code)
        async with AsyncSessionLocal() as db:
            session = await db.get(NoteSession, uuid.UUID(session_id))
            if session and not session.note_id and session.status == NoteSessionStatus.active and session.bot_status in ("downloading", "transcribing", "processing") and session.bot_last_event_at and session.bot_last_event_at.isoformat() == failure_attempt:
                session.bot_status = "failed"
                session.bot_status_reason = code
                session.status = NoteSessionStatus.failed
                await db.commit()
                await _notify_failed(db, session)
                await _push_status(session)
        return "failed"
