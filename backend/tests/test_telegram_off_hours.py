"""Business-hours boundaries and anti-spam rules for the Telegram reply."""
import unittest
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services.telegram_bot import is_company_working_time, is_staff_sender, should_send_off_hours_reply


ALMATY = ZoneInfo("Asia/Almaty")


class TelegramOffHoursTests(unittest.TestCase):
    def test_workday_boundaries_are_exact(self) -> None:
        self.assertFalse(is_company_working_time(datetime(2026, 9, 30, 9, 59, tzinfo=ALMATY)))
        self.assertTrue(is_company_working_time(datetime(2026, 9, 30, 10, 0, tzinfo=ALMATY)))
        self.assertTrue(is_company_working_time(datetime(2026, 9, 30, 18, 59, tzinfo=ALMATY)))
        self.assertFalse(is_company_working_time(datetime(2026, 9, 30, 19, 0, tzinfo=ALMATY)))

    def test_weekend_is_always_closed(self) -> None:
        self.assertFalse(is_company_working_time(datetime(2026, 10, 3, 12, 0, tzinfo=ALMATY)))

    def test_timezone_is_not_server_local_time(self) -> None:
        # 04:00 UTC is 09:00 in Almaty on this date.
        self.assertFalse(is_company_working_time(datetime(2026, 9, 30, 4, 0, tzinfo=timezone.utc)))

    def test_staff_bots_and_unbound_chats_never_receive_client_reply(self) -> None:
        moment = datetime(2026, 9, 30, 20, 0, tzinfo=ALMATY)
        base = dict(moment=moment, last_reply_at=None, chat_status="active")
        self.assertFalse(should_send_off_hours_reply(**base, sender_is_staff=True, sender_is_bot=False))
        self.assertFalse(should_send_off_hours_reply(**base, sender_is_staff=False, sender_is_bot=True))
        self.assertFalse(should_send_off_hours_reply(
            moment=moment, last_reply_at=None, sender_is_staff=False,
            sender_is_bot=False, chat_status="unbound",
        ))

    def test_cooldown_survives_multiple_messages(self) -> None:
        """В одной переписке — один автоответ; вернулся через 6 часов — ещё один."""
        moment = datetime(2026, 9, 30, 20, 0, tzinfo=ALMATY)
        base = dict(moment=moment, sender_is_staff=False, sender_is_bot=False, chat_status="active")
        self.assertFalse(should_send_off_hours_reply(**base, last_reply_at=moment - timedelta(hours=1)))
        self.assertFalse(should_send_off_hours_reply(**base, last_reply_at=moment - timedelta(hours=5, minutes=59)))
        self.assertTrue(should_send_off_hours_reply(**base, last_reply_at=moment - timedelta(hours=6)))


    def test_holiday_on_weekday_gets_reply(self) -> None:
        # 16 декабря 2026 — среда, День Независимости.
        moment = datetime(2026, 12, 16, 12, 0, tzinfo=ALMATY)
        self.assertFalse(is_company_working_time(moment))
        self.assertTrue(should_send_off_hours_reply(
            moment=moment, last_reply_at=None, sender_is_staff=False,
            sender_is_bot=False, chat_status="active",
        ))

    def test_bot_is_silent_while_staff_is_in_conversation(self) -> None:
        moment = datetime(2026, 9, 30, 21, 0, tzinfo=ALMATY)
        base = dict(moment=moment, last_reply_at=None, sender_is_staff=False,
                    sender_is_bot=False, chat_status="active", staff_quiet_seconds=3 * 3600)
        # Ментор писал 2 часа назад — бот молчит.
        self.assertFalse(should_send_off_hours_reply(
            **base, last_staff_message_at=moment - timedelta(hours=2)))
        # Молчит дольше 3 часов — автоответ.
        self.assertTrue(should_send_off_hours_reply(
            **base, last_staff_message_at=moment - timedelta(hours=3, minutes=1)))
        # Ментор в этом чате не писал вовсе — автоответ.
        self.assertTrue(should_send_off_hours_reply(**base, last_staff_message_at=None))


class StaffSenderTests(unittest.TestCase):
    def test_mentor_confirmed_in_chat_is_staff_without_telegram_id(self) -> None:
        self.assertTrue(is_staff_sender(user_role=None, user_is_active=False, chat_identity_role="mentor"))

    def test_active_staff_account_is_staff(self) -> None:
        for role in ("admin", "mzk_manager", "mentor"):
            with self.subTest(role=role):
                self.assertTrue(is_staff_sender(user_role=role, user_is_active=True, chat_identity_role=None))

    def test_student_with_telegram_id_is_a_client(self) -> None:
        self.assertFalse(is_staff_sender(user_role="student", user_is_active=True, chat_identity_role=None))
        self.assertFalse(is_staff_sender(user_role="student", user_is_active=True, chat_identity_role="student"))

    def test_deactivated_staff_is_a_client(self) -> None:
        self.assertFalse(is_staff_sender(user_role="mentor", user_is_active=False, chat_identity_role=None))

    def test_unknown_sender_is_a_client(self) -> None:
        self.assertFalse(is_staff_sender(user_role=None, user_is_active=False, chat_identity_role="unknown"))


if __name__ == "__main__":
    unittest.main()
