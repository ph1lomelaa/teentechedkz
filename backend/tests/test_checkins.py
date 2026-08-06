"""Правила ежедневного чекина: окно, статус, кто обязан отмечаться."""
import unittest
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.models.user import UserRole
from app.models.user_checkin import CheckinStatus
from app.services.checkins import (
    checkin_status_for,
    is_checkin_role,
    is_workday,
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


if __name__ == "__main__":
    unittest.main()
