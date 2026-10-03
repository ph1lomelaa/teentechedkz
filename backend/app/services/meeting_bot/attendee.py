"""Провайдер бота — Attendee (https://github.com/attendee-labs/attendee) на нашем сервере.

API сверено с исходниками Attendee (коммит 500168b от 01.10.2026):
POST /api/v1/bots, /bots/{id}/leave, /bots/{id}/transcript, /bots/{id}/recording,
/zoom_oauth_connections; вебхуки подписаны HMAC-SHA256 (X-Webhook-Signature).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging

import httpx

from app.core.config import settings
from app.services.meeting_bot.base import (
    CreateBotRequest,
    MeetingBotError,
    ProviderBot,
    ZoomConnection,
)
from app.services.meeting_bot.platforms import ZOOM
from app.services.meeting_bot.quality import Utterance

logger = logging.getLogger(__name__)

WEBHOOK_TRIGGERS = ["bot.state_change", "transcript.update", "participant_events.join_leave"]
RECORDING_MAX_BYTES = 300 * 1024 * 1024


def sign_attendee_payload(payload: dict, secret_b64: str) -> str:
    """Подпись так же, как её считает Attendee (bots/webhook_utils.sign_payload)."""
    payload_json = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hmac.new(base64.b64decode(secret_b64), payload_json.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")


def build_create_payload(request: CreateBotRequest) -> dict:
    """Тело POST /api/v1/bots. Вынесено отдельно — покрыто тестами."""
    payload: dict = {
        "meeting_url": request.meeting_url,
        "bot_name": request.bot_name,
        "metadata": request.metadata,
        "transcription_settings": {"deepgram": {"language": request.language, "model": "nova-3"}},
        # Только звук: файл меньше, его копируем к себе для повторного распознавания.
        "recording_settings": {"format": "mp3"},
        "automatic_leave_settings": {
            # Ментору напоминаем «впустите бота» через 3 минуты (сторож),
            # сам бот ждёт в зале ожидания до 10 минут.
            "waiting_room_timeout_seconds": 600,
            "only_participant_in_meeting_timeout_seconds": 120,
            "authorized_user_not_in_meeting_timeout_seconds": 600,
        },
    }
    if request.chat_message:
        payload["bot_chat_message"] = {"to": "everyone", "message": request.chat_message}
    if request.deduplication_key:
        payload["deduplication_key"] = request.deduplication_key
    # Вебхук на уровне бота — только https (требование Attendee). Без него
    # состояние подтягивает сторож опросом API.
    if request.webhook_url and request.webhook_url.startswith("https://"):
        payload["webhooks"] = [{"url": request.webhook_url, "triggers": WEBHOOK_TRIGGERS}]
    if request.platform == ZOOM and request.zoom_user_id:
        payload["zoom_settings"] = {
            "onbehalf_token": {"zoom_oauth_connection_user_id": request.zoom_user_id},
        }
    return payload


def parse_utterance(row: dict) -> Utterance | None:
    transcription = row.get("transcription") or {}
    text = (transcription.get("transcript") or "").strip()
    if not text:
        return None
    confidence = transcription.get("confidence")
    return Utterance(
        speaker=row.get("speaker_name"),
        text=text,
        start_ms=int(row.get("timestamp_ms") or 0),
        duration_ms=int(row.get("duration_ms") or 0),
        is_host=row.get("speaker_is_host"),
        confidence=float(confidence) if isinstance(confidence, (int, float)) else None,
    )


class AttendeeProvider:
    name = "attendee"

    def __init__(self, base_url: str | None = None, api_key: str | None = None, webhook_secret: str | None = None):
        self.base_url = (base_url if base_url is not None else settings.ATTENDEE_API_URL).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.ATTENDEE_API_KEY
        self.webhook_secret = webhook_secret if webhook_secret is not None else settings.ATTENDEE_WEBHOOK_SECRET

    def _client(self) -> httpx.AsyncClient:
        if not self.base_url or not self.api_key:
            raise MeetingBotError("Attendee не настроен (ATTENDEE_API_URL / ATTENDEE_API_KEY)", code="provider_unavailable")
        return httpx.AsyncClient(
            base_url=f"{self.base_url}/api/v1",
            headers={"Authorization": f"Token {self.api_key}", "Content-Type": "application/json"},
            timeout=30,
        )

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            async with self._client() as client:
                response = await client.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            logger.warning("Attendee %s %s failed: %s", method, path, exc)
            raise MeetingBotError("Сервис записи недоступен", code="provider_unavailable") from exc
        if response.status_code >= 400:
            logger.warning("Attendee %s %s -> %s %s", method, path, response.status_code, response.text[:500])
            raise MeetingBotError(
                f"Attendee ответил {response.status_code}",
                code="provider_unavailable",
                status=response.status_code,
            )
        return response

    async def create_bot(self, request: CreateBotRequest) -> ProviderBot:
        response = await self._request("POST", "/bots", json=build_create_payload(request))
        data = response.json()
        return ProviderBot(external_id=data["id"], state=data.get("state", "joining"), events=data.get("events") or [])

    async def leave_bot(self, external_id: str) -> None:
        await self._request("POST", f"/bots/{external_id}/leave")

    async def get_bot(self, external_id: str) -> ProviderBot:
        data = (await self._request("GET", f"/bots/{external_id}")).json()
        return ProviderBot(external_id=data["id"], state=data.get("state", ""), events=data.get("events") or [])

    async def get_transcript(self, external_id: str) -> list[Utterance]:
        rows = (await self._request("GET", f"/bots/{external_id}/transcript")).json()
        return [u for u in (parse_utterance(row) for row in rows or []) if u]

    async def get_recording(self, external_id: str) -> tuple[bytes, str] | None:
        try:
            data = (await self._request("GET", f"/bots/{external_id}/recording")).json()
        except MeetingBotError as exc:
            if exc.status == 404:
                return None
            raise
        url = data.get("url")
        if not url:
            return None
        try:
            async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise MeetingBotError("Не удалось скачать запись встречи", code="provider_unavailable") from exc
        if len(response.content) > RECORDING_MAX_BYTES:
            raise MeetingBotError("Запись встречи слишком большая", code="provider_unavailable")
        return response.content, response.headers.get("content-type", "audio/mpeg").split(";")[0]

    async def create_zoom_connection(self, *, code: str, redirect_uri: str, metadata: dict[str, str]) -> ZoomConnection:
        response = await self._request(
            "POST",
            "/zoom_oauth_connections",
            json={
                "authorization_code": code,
                "redirect_uri": redirect_uri,
                "is_onbehalf_token_supported": True,
                "is_local_recording_token_supported": True,
                "metadata": metadata,
            },
        )
        data = response.json()
        return ZoomConnection(id=data["id"], user_id=data.get("user_id"), state=data.get("state", "connected"))

    async def delete_zoom_connection(self, connection_id: str) -> None:
        try:
            await self._request("DELETE", f"/zoom_oauth_connections/{connection_id}")
        except MeetingBotError as exc:
            if exc.status != 404:
                raise

    def verify_webhook(self, payload: dict, signature: str | None) -> bool:
        if not self.webhook_secret or not signature:
            return False
        try:
            expected = sign_attendee_payload(payload, self.webhook_secret)
        except (ValueError, TypeError):
            logger.error("ATTENDEE_WEBHOOK_SECRET is not valid base64")
            return False
        return hmac.compare_digest(expected, signature)
