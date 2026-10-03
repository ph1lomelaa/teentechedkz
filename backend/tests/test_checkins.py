"""Правила ежедневного чекина: окно, статус, кто обязан отмечаться."""
import unittest
from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.core.config import settings
from app.models.user import UserRole
from app.models.user_checkin import CheckinStatus
from app.services.checkin_notifier import plan_for_user
from app.services.checkins import (
    CHECKIN_TIMEZONES,
    checkin_status_for,
    is_allowed_timezone,
    is_checkin_role,
    is_workday,
    reminder_is_due,
    user_tz,
    window_is_closed,
)

TZ = ZoneInfo("Asia/Almaty")


def at(hour: int, minute: int) -> datetime:
    return datetime(2026, 8, 6, hour, minute, tzinfo=TZ)  # четверг


class RoleTests(unittest.TestCase):
    def test_staff_checks_in(self):
        self.assertTrue(is_checkin_role(UserRole.mentor))
        self.assertTrue(is_checkin_role(UserRole.mzk_manager))

    def test_student_and_admin_do_not(self):
        """Чекин про рабочий день ментора/МЗК — студентов он не касается."""
        self.assertFalse(is_checkin_role(UserRole.student))
        self.assertFalse(is_checkin_role(UserRole.admin))


class StatusTests(unittest.TestCase):
    KW = {"hour": 10, "minute": 0, "grace_minutes": 30}

    def test_exactly_at_open_is_on_time(self):
        self.assertEqual(checkin_status_for(checked_in_local=at(10, 0), **self.KW),
                         CheckinStatus.on_time)

    def test_inside_grace_is_on_time(self):
        self.assertEqual(checkin_status_for(checked_in_local=at(10, 29), **self.KW),
                         CheckinStatus.on_time)

    def test_edge_of_grace_is_on_time(self):
        self.assertEqual(checkin_status_for(checked_in_local=at(10, 30), **self.KW),
                         CheckinStatus.on_time)

    def test_after_grace_is_late(self):
        self.assertEqual(checkin_status_for(checked_in_local=at(10, 31), **self.KW),
                         CheckinStatus.late)

    def test_early_bird_is_on_time(self):
        """Пришёл раньше окна — это не нарушение."""
        self.assertEqual(checkin_status_for(checked_in_local=at(9, 15), **self.KW),
                         CheckinStatus.on_time)


class WindowTests(unittest.TestCase):
    KW = {"hour": 10, "minute": 0, "window_minutes": 240}

    def test_window_open_during_morning(self):
        self.assertFalse(window_is_closed(local_now_dt=at(11, 0), **self.KW))

    def test_window_closed_after_limit(self):
        self.assertTrue(window_is_closed(local_now_dt=at(14, 1), **self.KW))

    def test_boundary_closes(self):
        self.assertTrue(window_is_closed(local_now_dt=at(14, 0), **self.KW))


class WorkdayTests(unittest.TestCase):
    def test_weekdays_require_checkin(self):
        self.assertTrue(is_workday(date(2026, 8, 6)))   # четверг
        self.assertTrue(is_workday(date(2026, 8, 7)))   # пятница

    def test_weekend_does_not(self):
        """Выходные не должны копить пропуски в статистике."""
        self.assertFalse(is_workday(date(2026, 8, 8)))   # суббота
        self.assertFalse(is_workday(date(2026, 8, 9)))   # воскресенье


class ReminderTests(unittest.TestCase):
    KW = {"hour": 10, "minute": 0, "lead_minutes": 10}

    def test_ten_minutes_before_is_due(self):
        self.assertTrue(reminder_is_due(local_now_dt=at(9, 50), **self.KW))
        self.assertTrue(reminder_is_due(local_now_dt=at(9, 59), **self.KW))

    def test_too_early_or_already_open_is_not(self):
        self.assertFalse(reminder_is_due(local_now_dt=at(9, 49), **self.KW))
        self.assertFalse(reminder_is_due(local_now_dt=at(10, 0), **self.KW))


class UserTimezoneTests(unittest.TestCase):
    """Регламент п.2.1: ментор в Европе отмечается в 10:00 по своему времени."""

    def u(self, tz):
        return type("U", (), {"checkin_timezone": tz})()

    def test_default_is_company_timezone(self):
        self.assertEqual(user_tz(self.u(None), "Asia/Almaty"), "Asia/Almaty")

    def test_own_timezone_is_used(self):
        self.assertEqual(user_tz(self.u("Europe/Berlin"), "Asia/Almaty"), "Europe/Berlin")

    def test_unknown_value_falls_back(self):
        """Мусор в БД не должен ронять цикл чекинов."""
        self.assertEqual(user_tz(self.u("Mars/Olympus"), "Asia/Almaty"), "Asia/Almaty")
        self.assertFalse(is_allowed_timezone("Mars/Olympus"))

    def test_all_listed_timezones_exist(self):
        for tz, _label in CHECKIN_TIMEZONES:
            with self.subTest(tz=tz):
                ZoneInfo(tz)

    def test_berlin_ten_oh_five_is_on_time_while_almaty_is_afternoon(self):
        berlin = datetime(2026, 8, 6, 10, 5, tzinfo=ZoneInfo("Europe/Berlin"))
        self.assertEqual(berlin.astimezone(TZ).hour, 13)
        self.assertEqual(
            checkin_status_for(checked_in_local=berlin, hour=10, minute=0, grace_minutes=30),
            CheckinStatus.on_time,
        )


class NotifierPlanTests(unittest.TestCase):
    """Что цикл делает с неотметившимся — в поясе сотрудника."""

    BERLIN = ZoneInfo("Europe/Berlin")

    def berlin(self, hour, minute):
        return datetime(2026, 8, 6, hour, minute, tzinfo=self.BERLIN)  # четверг

    # Значения фиксируем: локальный .env их переопределяет.
    @patch.multiple(settings, CHECKIN_HOUR=10, CHECKIN_MINUTE=0,
                    CHECKIN_REMINDER_LEAD_MINUTES=10, CHECKIN_WINDOW_MINUTES=240)
    def test_sequence_through_the_morning(self):
        self.assertIsNone(plan_for_user(self.berlin(9, 49)))
        self.assertEqual(plan_for_user(self.berlin(9, 50)), "soon")
        self.assertEqual(plan_for_user(self.berlin(10, 0)), "due")
        self.assertEqual(plan_for_user(self.berlin(13, 59)), "due")
        self.assertEqual(plan_for_user(self.berlin(14, 0)), "missed")

    def test_almaty_morning_does_not_touch_berlin(self):
        """В 10:00 по Алматы в Берлине 07:00 (лето) — ментору рано напоминать."""
        almaty_ten = datetime(2026, 8, 6, 10, 0, tzinfo=TZ)
        self.assertIsNone(plan_for_user(almaty_ten.astimezone(self.BERLIN)))

    def test_weekend_is_skipped(self):
        saturday = datetime(2026, 8, 8, 10, 0, tzinfo=self.BERLIN)
        self.assertIsNone(plan_for_user(saturday))


if __name__ == "__main__":
    unittest.main()
