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


async def transcribe_audio_file(content: bytes, mime_type: str, language: str | None = None) -> str:
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
            # Язык сессии (ru / kk / en); `multi` не покрывает казахский.
            params={**DEEPGRAM_PARAMS, **({"language": language} if language else {})},
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


def parse_deepgram_utterances(data: dict) -> list[dict]:
    """Реплики по говорящим из ответа Deepgram с utterances=true.
    Чистая функция — покрыта тестами. Возвращает словари для Utterance:
    speaker («Спикер 1»), text, start_ms, duration_ms, confidence."""
    rows = []
    for item in (data.get("results") or {}).get("utterances") or []:
        text = (item.get("transcript") or "").strip()
        if not text:
            continue
        start = float(item.get("start") or 0)
        end = float(item.get("end") or start)
        speaker = item.get("speaker")
        confidence = item.get("confidence")
        rows.append(
            {
                "speaker": f"Спикер {int(speaker) + 1}" if isinstance(speaker, (int, float)) else None,
                "text": text,
                "start_ms": int(start * 1000),
                "duration_ms": max(0, int((end - start) * 1000)),
                "confidence": float(confidence) if isinstance(confidence, (int, float)) else None,
            }
        )
    return rows


async def transcribe_audio_utterances(content: bytes, mime_type: str, language: str | None = None) -> list[dict]:
    """Целая запись встречи (загруженный ментором файл) → реплики по говорящим.
    Длинный файл Deepgram обрабатывает минуты, поэтому таймаут большой —
    вызывается только из воркера."""
    if not settings.DEEPGRAM_API_KEY:
        raise RuntimeError("DEEPGRAM_API_KEY не настроен на сервере")

    async with httpx.AsyncClient(timeout=900) as client:
        response = await client.post(
            DEEPGRAM_LISTEN_URL,
            params={**DEEPGRAM_PARAMS, "utterances": "true", **({"language": language} if language else {})},
            headers={
                "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
                "Content-Type": mime_type or "application/octet-stream",
            },
            content=content,
        )
    response.raise_for_status()
    return parse_deepgram_utterances(response.json())
