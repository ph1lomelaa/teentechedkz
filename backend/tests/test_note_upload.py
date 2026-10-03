"""Конспект из загруженного файла: какие файлы принимаем и как читаем реплики Deepgram."""
import unittest

from app.services.deepgram_rest import parse_deepgram_utterances
from app.services.meeting_bot.quality import QUALITY_EMPTY, Utterance, evaluate_quality
from app.services.meeting_bot.reasons import reason_message
from app.services.note_upload import guess_mime, is_allowed_audio


class AllowedFileTests(unittest.TestCase):
    def test_audio_and_video_from_phones_and_messengers(self):
        for name in ("call.m4a", "voice.ogg", "telegram.opus", "zoom.mp4", "IMG_0001.MOV", "rec.mp3", "rec.amr"):
            self.assertTrue(is_allowed_audio(name, None), name)

    def test_unknown_extension_is_accepted_by_mime(self):
        self.assertTrue(is_allowed_audio("recording", "audio/x-m4a"))

    def test_documents_are_rejected(self):
        for name, mime in (("notes.pdf", "application/pdf"), ("photo.jpg", "image/jpeg"), ("", None)):
            self.assertFalse(is_allowed_audio(name, mime), name)

    def test_mime_guess_for_browsers_that_send_octet_stream(self):
        self.assertEqual(guess_mime("call.m4a", "application/octet-stream"), "audio/mp4")
        self.assertEqual(guess_mime("x.ogg", None), "audio/ogg")
        self.assertEqual(guess_mime("x.mp3", "audio/mpeg"), "audio/mpeg")


class DeepgramUtteranceTests(unittest.TestCase):
    def test_speakers_and_timing(self):
        data = {"results": {"utterances": [
            {"start": 0.5, "end": 3.0, "speaker": 0, "confidence": 0.92, "transcript": " Здравствуйте "},
            {"start": 3.4, "end": 9.9, "speaker": 1, "confidence": 0.88, "transcript": "Мне интересна Германия"},
            {"start": 10, "end": 10.2, "speaker": 1, "transcript": "  "},
        ]}}
        rows = parse_deepgram_utterances(data)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0], {"speaker": "Спикер 1", "text": "Здравствуйте", "start_ms": 500, "duration_ms": 2500, "confidence": 0.92})
        self.assertEqual(rows[1]["speaker"], "Спикер 2")
        # Ряды подходят для проверки качества как есть.
        result = evaluate_quality([Utterance(**row) for row in rows], duration_seconds=10)
        self.assertEqual(result.metrics["speakers"], 2)

    def test_empty_response_means_empty_note(self):
        self.assertEqual(parse_deepgram_utterances({}), [])
        self.assertEqual(evaluate_quality([], duration_seconds=60).quality, QUALITY_EMPTY)

    def test_file_specific_messages(self):
        self.assertIn("В файле", reason_message("no_text_file"))
        self.assertIn("формате", reason_message("transcription_failed"))


if __name__ == "__main__":
    unittest.main()
