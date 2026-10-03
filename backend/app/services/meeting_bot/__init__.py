"""Бот, который заходит во встречу и пишет её для конспекта."""
from __future__ import annotations

from app.core.config import settings
from app.services.meeting_bot.base import MeetingBotError, MeetingBotProvider


def get_provider(name: str | None = None) -> MeetingBotProvider:
    provider = (name or settings.MEETING_BOT_PROVIDER or "attendee").lower()
    if provider == "mock":
        from app.services.meeting_bot.mock import MockProvider

        return MockProvider()
    if provider == "attendee":
        from app.services.meeting_bot.attendee import AttendeeProvider

        return AttendeeProvider()
    raise MeetingBotError(f"Неизвестный провайдер бота: {provider}")


__all__ = ["MeetingBotError", "MeetingBotProvider", "get_provider"]
