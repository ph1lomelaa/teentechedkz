"""Бот для записи встреч: ссылки, состояния провайдера, проверка качества,
подпись вебхуков Attendee, тело запроса на создание бота, state подключения Zoom."""
import base64
import unittest
import uuid
from datetime import datetime, timedelta, timezone

from app.api.v1.endpoints.integrations import (
    make_zoom_state,
    read_zoom_state,
    read_zoom_state_full,
    safe_return_path,
)
from app.services.meeting_bot.attendee import (
    AttendeeProvider,
    build_create_payload,
    parse_utterance,
    sign_attendee_payload,
)
from app.services.meeting_bot.base import CreateBotRequest
from app.services.meeting_bot.platforms import GOOGLE_MEET, TEAMS, ZOOM, detect_platform
from app.services.meeting_bot.quality import (
    QUALITY_EMPTY,
    QUALITY_INCOMPLETE,
    QUALITY_OK,
    Utterance,
    evaluate_quality,
)
from app.services.meeting_bot.reasons import DEFAULT_MESSAGE, reason_message
from app.services.meeting_bot.service import map_provider_state


class PlatformTests(unittest.TestCase):
    def test_supported_links(self):
        self.assertEqual(detect_platform("https://us02web.zoom.us/j/8123456789?pwd=abc"), ZOOM)
        self.assertEqual(detect_platform("https://zoom.us/my/mentor.name"), ZOOM)
        self.assertEqual(detect_platform("meet.google.com/abc-defg-hij"), GOOGLE_MEET)
        self.assertEqual(detect_platform("https://teams.microsoft.com/l/meetup-join/19%3a"), TEAMS)
        self.assertEqual(detect_platform("https://teams.live.com/meet/123"), TEAMS)

    def test_unsupported_links(self):
        for url in (
            "https://t.me/+abcdef",
            "https://telemost.yandex.ru/j/123",
            "https://zoom.us/pricing",
            "https://meet.google.com/",
            "https://evil.example.com/zoom.us/j/1",
            "javascript:alert(1)",
            "",
        ):
            self.assertIsNone(detect_platform(url), url)


class StateMappingTests(unittest.TestCase):
    def test_happy_path(self):
        self.assertEqual(map_provider_state("joining", had_joined=False).bot_status, "joining")
        self.assertEqual(map_provider_state("waiting_room", had_joined=False).bot_status, "waiting_room")
        self.assertEqual(map_provider_state("joined_recording", had_joined=False).bot_status, "recording")
        ended = map_provider_state("ended", event_type="post_processing_completed", had_joined=True)
        self.assertEqual((ended.bot_status, ended.finalize), ("processing", True))

    def test_not_admitted_is_failure_with_reason(self):
        change = map_provider_state(
            "ended", event_type="could_not_join_meeting", event_sub_type="waiting_room_timeout_exceeded", had_joined=False
        )
        self.assertEqual((change.bot_status, change.reason, change.finalize), ("failed", "waiting_room_timeout_exceeded", False))

    def test_crash_after_joining_keeps_text(self):
        """Бот выпал посреди встречи — собираем конспект из того, что успели, с пометкой."""
        change = map_provider_state("fatal_error", event_sub_type="heartbeat_timeout", had_joined=True)
        self.assertEqual((change.bot_status, change.reason, change.finalize), ("processing", "heartbeat_timeout", True))

    def test_crash_before_joining_is_failure(self):
        change = map_provider_state("fatal_error", event_sub_type="bot_not_launched", had_joined=False)
        self.assertEqual(change.bot_status, "failed")

    def test_permission_denied_asks_mentor(self):
        change = map_provider_state("joined_recording_permission_denied", had_joined=False)
        self.assertEqual(change.bot_status, "waiting_permission")

    def test_unknown_state_is_ignored(self):
        self.assertIsNone(map_provider_state("data_deleted", had_joined=True))


def talk(minutes: float, *, speakers=("Ментор", "Студент"), words_per_line=12, lines_per_minute=6):
    rows = []
    total = int(minutes * lines_per_minute)
    for i in range(total):
        speaker = speakers[i % len(speakers)]
        rows.append(
            Utterance(
                speaker=speaker,
                text=" ".join(["слово"] * words_per_line),
                start_ms=int(i * 60_000 / lines_per_minute),
                duration_ms=5_000,
                is_host=speaker == speakers[0],
                confidence=0.9,
            )
        )
    return rows


class QualityTests(unittest.TestCase):
    def test_empty_text(self):
        self.assertEqual(evaluate_quality([], duration_seconds=600).quality, QUALITY_EMPTY)
        blank = [Utterance(speaker="A", text="  ", start_ms=0)]
        self.assertEqual(evaluate_quality(blank, duration_seconds=600).quality, QUALITY_EMPTY)

    def test_normal_meeting_is_ok(self):
        result = evaluate_quality(talk(30), duration_seconds=1800, enforce=True)
        self.assertEqual(result.quality, QUALITY_OK, result.reasons)
        self.assertEqual(result.metrics["speakers"], 2)

    def test_cut_short_is_incomplete_even_in_observation_mode(self):
        result = evaluate_quality(talk(10), duration_seconds=600, cut_short=True, enforce=False)
        self.assertEqual(result.quality, QUALITY_INCOMPLETE)
        self.assertIn("cut_short", result.reasons)

    def test_thresholds_only_count_in_observation_mode(self):
        """Пока пороги не откалиброваны — считаем показатели, но не помечаем."""
        little = talk(1)  # ~72 слова за 30 минут
        observed = evaluate_quality(little, duration_seconds=1800, enforce=False)
        self.assertEqual(observed.quality, QUALITY_OK)
        self.assertLess(observed.metrics["words_per_minute"], 40)
        enforced = evaluate_quality(little, duration_seconds=1800, enforce=True)
        self.assertIn("too_little_text", enforced.reasons)

    def test_single_speaker_and_gap(self):
        rows = talk(10, speakers=("Ментор",))
        rows.append(Utterance(speaker="Ментор", text="после паузы " * 5, start_ms=rows[-1].start_ms + 400_000))
        result = evaluate_quality(rows, duration_seconds=1200, enforce=True)
        self.assertIn("single_speaker", result.reasons)
        self.assertIn("long_gap", result.reasons)

    def test_soft_warnings_do_not_mark_incomplete(self):
        rows = [
            Utterance(speaker="Ментор", text="слово " * 400, start_ms=0, duration_ms=60_000, is_host=True, confidence=0.4),
            Utterance(speaker="Студент", text="да", start_ms=61_000, duration_ms=1_000, is_host=False, confidence=0.4),
        ]
        result = evaluate_quality(rows, duration_seconds=300, enforce=True)
        self.assertIn("low_confidence", result.warnings)
        self.assertIn("student_mostly_silent", result.warnings)
        self.assertNotIn("low_confidence", result.reasons)


class AttendeeTests(unittest.TestCase):
    SECRET = base64.b64encode(b"x" * 32).decode()

    def test_signature_round_trip(self):
        payload = {"idempotency_key": "k", "bot_id": "bot_1", "trigger": "bot.state_change", "data": {"new_state": "ended", "текст": "да"}}
        signature = sign_attendee_payload(payload, self.SECRET)
        provider = AttendeeProvider(base_url="https://a", api_key="k", webhook_secret=self.SECRET)
        self.assertTrue(provider.verify_webhook(payload, signature))
        self.assertFalse(provider.verify_webhook({**payload, "trigger": "x"}, signature))
        self.assertFalse(provider.verify_webhook(payload, None))
        self.assertFalse(AttendeeProvider(base_url="https://a", api_key="k", webhook_secret="").verify_webhook(payload, signature))

    def _request(self, **kwargs):
        defaults = dict(
            meeting_url="https://meet.google.com/abc-defg-hij",
            platform=GOOGLE_MEET,
            bot_name="TeenTechEd",
            language="kk",
            chat_message="Идёт запись",
            metadata={"note_session_id": "s1"},
            webhook_url="https://teenteched.kz/api/v1/webhooks/meeting-bot/attendee",
        )
        defaults.update(kwargs)
        return CreateBotRequest(**defaults)

    def test_create_payload(self):
        payload = build_create_payload(self._request())
        self.assertEqual(payload["transcription_settings"]["deepgram"]["language"], "kk")
        self.assertEqual(payload["recording_settings"], {"format": "mp3"})
        self.assertEqual(payload["bot_chat_message"]["message"], "Идёт запись")
        self.assertEqual(payload["webhooks"][0]["url"], "https://teenteched.kz/api/v1/webhooks/meeting-bot/attendee")
        self.assertNotIn("zoom_settings", payload)

    def test_zoom_uses_onbehalf_token(self):
        payload = build_create_payload(self._request(platform=ZOOM, meeting_url="https://zoom.us/j/1", zoom_user_id="zu_1"))
        self.assertEqual(payload["zoom_settings"]["onbehalf_token"]["zoom_oauth_connection_user_id"], "zu_1")

    def test_http_webhook_is_not_sent(self):
        """Attendee принимает вебхуки только на https — локально их не передаём."""
        payload = build_create_payload(self._request(webhook_url="http://localhost:8000/api/v1/webhooks/meeting-bot/attendee"))
        self.assertNotIn("webhooks", payload)

    def test_parse_utterance_keeps_confidence(self):
        row = {"speaker_name": "Ментор", "speaker_is_host": True, "timestamp_ms": 1700000000000, "duration_ms": 3000,
               "transcription": {"transcript": " Привет ", "confidence": 0.93}}
        utterance = parse_utterance(row)
        self.assertEqual((utterance.text, utterance.confidence, utterance.is_host), ("Привет", 0.93, True))
        self.assertIsNone(parse_utterance({"transcription": {"transcript": ""}}))
        self.assertIsNone(parse_utterance({"transcription": None}))


class ReasonTests(unittest.TestCase):
    def test_known_and_unknown_codes(self):
        self.assertIn("впустите", reason_message("waiting_room_timeout_exceeded").lower())
        self.assertEqual(reason_message("something_new"), DEFAULT_MESSAGE)
        self.assertIsNone(reason_message(None))


class ZoomStateTests(unittest.TestCase):
    def test_round_trip(self):
        user_id = uuid.uuid4()
        self.assertEqual(read_zoom_state(make_zoom_state(user_id)), user_id)

    def test_return_path_only_inside_cabinet(self):
        user_id = uuid.uuid4()
        state = make_zoom_state(user_id, return_to="/workspace/meetings/session/abc")
        self.assertEqual(read_zoom_state_full(state), (user_id, "/workspace/meetings/session/abc"))
        for bad in ("https://evil.example.com", "//evil.example.com", "/admin", None):
            self.assertEqual(safe_return_path(bad), "/workspace/meetings", bad)

    def test_expired_and_forged_state_rejected(self):
        old = datetime.now(timezone.utc) - timedelta(hours=1)
        self.assertIsNone(read_zoom_state(make_zoom_state(uuid.uuid4(), now=old)))
        self.assertIsNone(read_zoom_state("not-a-token"))


if __name__ == "__main__":
    unittest.main()
