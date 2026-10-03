"""Производственный календарь РК: праздники, переносы, исключения постановлений."""
import unittest
from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.services import work_calendar
from app.services.checkins import is_workday
from app.services.work_calendar import holidays_for_year, is_working_day, is_working_time

ALMATY = ZoneInfo("Asia/Almaty")


class FixedHolidayTests(unittest.TestCase):
    def test_every_fixed_holiday_is_off(self):
        for d in (
            date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 7), date(2026, 3, 9),
            date(2026, 3, 23), date(2026, 5, 1), date(2026, 5, 7), date(2026, 7, 6),
            date(2026, 10, 26), date(2026, 12, 16),
        ):
            with self.subTest(d=d):
                self.assertFalse(is_working_day(d))

    def test_ordinary_weekday_is_working(self):
        self.assertTrue(is_working_day(date(2026, 10, 2)))   # пятница
        self.assertFalse(is_working_day(date(2026, 10, 3)))  # суббота


class TransferTests(unittest.TestCase):
    def test_holiday_on_sunday_moves_to_monday(self):
        # 30 августа 2026 — воскресенье: выходной переносится на понедельник 31-го.
        self.assertEqual(date(2026, 8, 30).weekday(), 6)
        self.assertFalse(is_working_day(date(2026, 8, 31)))
        self.assertTrue(is_working_day(date(2026, 9, 1)))

    def test_nauryz_on_weekend_shifts_each_day(self):
        # 2026: 21 марта — суббота, 22 — воскресенье, 23 — понедельник (праздник).
        # Два перенесённых дня ложатся на 24 и 25 марта.
        off = holidays_for_year(2026)
        self.assertIn(date(2026, 3, 24), off)
        self.assertIn(date(2026, 3, 25), off)
        self.assertTrue(is_working_day(date(2026, 3, 26)))

    def test_womens_day_on_sunday_moves_to_monday(self):
        self.assertEqual(date(2026, 3, 8).weekday(), 6)
        self.assertFalse(is_working_day(date(2026, 3, 9)))

    def test_christmas_on_weekend_is_not_transferred(self):
        # 7 января 2029 — воскресенье; религиозный праздник не переносится.
        self.assertEqual(date(2029, 1, 7).weekday(), 6)
        self.assertNotIn(date(2029, 1, 8), holidays_for_year(2029))

    def test_new_year_on_weekend(self):
        # 2028: 1 января — суббота, 2 — воскресенье → выходные 3 и 4 января.
        self.assertFalse(is_working_day(date(2028, 1, 3)))
        self.assertFalse(is_working_day(date(2028, 1, 4)))
        self.assertTrue(is_working_day(date(2028, 1, 5)))


class DecreeTests(unittest.TestCase):
    def test_kurban_ait_from_data(self):
        self.assertFalse(is_working_day(date(2026, 5, 27)))

    def test_decree_day_off_and_working_saturday(self):
        with patch.object(work_calendar, "EXTRA_DAYS_OFF", frozenset({date(2026, 11, 2)})), \
             patch.object(work_calendar, "EXTRA_WORKDAYS", frozenset({date(2026, 11, 7)})):
            self.assertFalse(is_working_day(date(2026, 11, 2)))   # понедельник — выходной
            self.assertTrue(is_working_day(date(2026, 11, 7)))    # суббота — рабочая


class WorkingTimeTests(unittest.TestCase):
    KW = {"timezone_name": "Asia/Almaty", "start_hour": 10, "end_hour": 19}

    def test_holiday_noon_is_off(self):
        self.assertFalse(is_working_time(datetime(2026, 12, 16, 12, 0, tzinfo=ALMATY), **self.KW))

    def test_regular_noon_is_on(self):
        self.assertTrue(is_working_time(datetime(2026, 12, 15, 12, 0, tzinfo=ALMATY), **self.KW))

    def test_checkin_uses_same_calendar(self):
        """В Наурыз отметка не требуется и пропуск не ставится."""
        self.assertFalse(is_workday(date(2026, 3, 23)))
        self.assertTrue(is_workday(date(2026, 3, 26)))


if __name__ == "__main__":
    unittest.main()
