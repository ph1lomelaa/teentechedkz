"""Заменяемый слой провайдера бота (Attendee сейчас, Recall.ai или другой — потом)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from app.services.meeting_bot.quality import Utterance


class MeetingBotError(Exception):
    """Провайдер ответил ошибкой или недоступен."""

    def __init__(self, message: str, *, code: str = "provider_unavailable", status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class CreateBotRequest:
    meeting_url: str
    platform: str
    bot_name: str
    language: str
    chat_message: str | None
    metadata: dict[str, str]
    webhook_url: str | None
    deduplication_key: str | None = None
    zoom_user_id: str | None = None


@dataclass
class ProviderBot:
    external_id: str
    state: str
    events: list[dict] = field(default_factory=list)


@dataclass
class ZoomConnection:
    id: str
    user_id: str | None
    state: str


class MeetingBotProvider(Protocol):
    name: str

    async def create_bot(self, request: CreateBotRequest) -> ProviderBot: ...

    async def leave_bot(self, external_id: str) -> None: ...

    async def get_bot(self, external_id: str) -> ProviderBot: ...

    async def get_transcript(self, external_id: str) -> list[Utterance]: ...

    async def get_recording(self, external_id: str) -> tuple[bytes, str] | None:
        """(содержимое, mime) записи звука или None, если записи нет."""
        ...

    async def create_zoom_connection(self, *, code: str, redirect_uri: str, metadata: dict[str, str]) -> ZoomConnection: ...

    async def delete_zoom_connection(self, connection_id: str) -> None: ...

    def verify_webhook(self, payload: dict, signature: str | None) -> bool: ...
