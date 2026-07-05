from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_PARAMS = {
    "model": "nova-3",
    "language": "multi",
    "punctuate": "true",
    "smart_format": "true",
    "diarize": "true",
}


async def transcribe_audio_file(content: bytes, mime_type: str) -> str:
    """Sends a complete, independently-decodable audio file (one rotated
    backup-recording segment) to Deepgram's pre-recorded REST endpoint and
    returns the flattened transcript text. Raises on failure — the caller
    (reconcile-audio) is expected to catch this per-chunk and mark it failed
    rather than aborting the whole reconciliation."""
    if not settings.DEEPGRAM_API_KEY:
        raise RuntimeError("DEEPGRAM_API_KEY не настроен на сервере")

    async with httpx.AsyncClient(timeout=120) as client:
        response = await client.post(
            DEEPGRAM_LISTEN_URL,
            params=DEEPGRAM_PARAMS,
            headers={
                "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
                "Content-Type": mime_type,
            },
            content=content,
        )
    response.raise_for_status()
    data = response.json()

    try:
        channels = data["results"]["channels"]
        parts = [
            channel["alternatives"][0]["transcript"]
            for channel in channels
            if channel.get("alternatives") and channel["alternatives"][0].get("transcript")
        ]
        return " ".join(part.strip() for part in parts if part.strip())
    except (KeyError, IndexError) as exc:
        raise RuntimeError(f"Неожиданный формат ответа Deepgram: {exc}") from exc
