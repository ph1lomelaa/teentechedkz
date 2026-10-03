"""Имитация бота для разработки и e2e — без Zoom, без Attendee.

Провайдер ничего не хранит: события «бот зашёл / пишет / закончил» генерирует
задача воркера simulate_mock_bot_task и отдаёт их в тот же обработчик, что и
настоящие вебхуки (service.handle_provider_event). Поэтому весь путь — статусы,
текст, проверка качества, черновик, уведомления — проверяется без внешних сервисов.
"""
from __future__ import annotations

import uuid

from app.services.meeting_bot.base import CreateBotRequest, ProviderBot, ZoomConnection
from app.services.meeting_bot.quality import Utterance


class MockProvider:
    name = "mock"

    async def create_bot(self, request: CreateBotRequest) -> ProviderBot:
        return ProviderBot(external_id=f"mock_{uuid.uuid4().hex[:16]}", state="joining")

    async def leave_bot(self, external_id: str) -> None:
        return None

    async def get_bot(self, external_id: str) -> ProviderBot:
        # Состояние имитации живёт в нашей БД — сторожу нечего сверять.
        return ProviderBot(external_id=external_id, state="unknown")

    async def get_transcript(self, external_id: str) -> list[Utterance]:
        # Пусто — финализация возьмёт фрагменты, пришедшие «вебхуками».
        return []

    async def get_recording(self, external_id: str) -> tuple[bytes, str] | None:
        return None

    async def create_zoom_connection(self, *, code: str, redirect_uri: str, metadata: dict[str, str]) -> ZoomConnection:
        return ZoomConnection(id=f"mockconn_{uuid.uuid4().hex[:12]}", user_id=f"mockzoom_{code[:8]}", state="connected")

    async def delete_zoom_connection(self, connection_id: str) -> None:
        return None

    def verify_webhook(self, payload: dict, signature: str | None) -> bool:
        return signature == "mock"


# Сценарий имитации: (задержка от старта в секундах, событие)
MOCK_SCRIPT: list[tuple[float, dict]] = [
    (2, {"trigger": "bot.state_change", "data": {"new_state": "waiting_room", "event_type": "put_in_waiting_room"}}),
    (6, {"trigger": "bot.state_change", "data": {"new_state": "joined_recording", "event_type": "joined_meeting"}}),
    (8, {"trigger": "transcript.update", "data": {
        "speaker_name": "Ментор", "speaker_uuid": "mentor", "speaker_is_host": True,
        "timestamp_ms": 0, "duration_ms": 4000,
        "transcription": {"transcript": "Здравствуйте! Давайте обсудим, куда вы планируете поступать."},
    }}),
    (11, {"trigger": "transcript.update", "data": {
        "speaker_name": "Студент", "speaker_uuid": "student", "speaker_is_host": False,
        "timestamp_ms": 5000, "duration_ms": 6000,
        "transcription": {"transcript": "Я думаю про Германию, бакалавриат по информатике, бюджет около десяти тысяч евро в год."},
    }}),
    (14, {"trigger": "transcript.update", "data": {
        "speaker_name": "Ментор", "speaker_uuid": "mentor", "speaker_is_host": True,
        "timestamp_ms": 12000, "duration_ms": 5000,
        "transcription": {"transcript": "Хорошо, к следующей встрече подготовьте результаты IELTS и список трёх университетов."},
    }}),
    (17, {"trigger": "bot.state_change", "data": {"new_state": "post_processing", "event_type": "meeting_ended"}}),
    (19, {"trigger": "bot.state_change", "data": {"new_state": "ended", "event_type": "post_processing_completed"}}),
]
