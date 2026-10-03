"""Производственный календарь компании: рабочие дни по праздникам РК.

Один источник для всего, что зависит от рабочего дня: автоответ бота в
нерабочее время и ежедневная отметка «Я на месте» (в праздник отметка не
нужна и пропуск не ставится).

Правило переноса (закон «О праздниках в РК»): если праздник совпал с
выходным, выходной переносится на следующий рабочий день. Религиозные
праздники — Православное Рождество и Курбан айт — не переносятся.
Курбан айт и переносы по постановлению правительства — в
app/core/kz_calendar_data.py.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.core.kz_calendar_data import EXTRA_DAYS_OFF, EXTRA_WORKDAYS, KURBAN_AIT

# (месяц, день, переносится ли при совпадении с выходным)
_FIXED_HOLIDAYS: tuple[tuple[int, int, bool], ...] = (
    (1, 1, True), (1, 2, True),           # Новый год
    (1, 7, False),                        # Православное Рождество
    (3, 8, True),                         # Международный женский день
    (3, 21, True), (3, 22, True), (3, 23, True),  # Наурыз мейрамы
    (5, 1, True),                         # Праздник единства народа Казахстана
    (5, 7, True),                         # День защитника Отечества
    (5, 9, True),                         # День Победы
    (7, 6, True),                         # День столицы
    (8, 30, True),                        # День Конституции
    (10, 25, True),                       # День Республики
    (12, 16, True),                       # День Независимости
)


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


@lru_cache(maxsize=16)
def holidays_for_year(year: int) -> frozenset[date]:
    """Все нерабочие праздничные дни года, включая перенесённые выходные."""
    holidays = {date(year, m, d) for m, d, _ in _FIXED_HOLIDAYS}
    if year in KURBAN_AIT:
        holidays.add(KURBAN_AIT[year])

    days_off = set(holidays)
    # Переносим по порядку: если Наурыз целиком лёг на выходные, переносов
    # будет несколько, и каждый занимает следующий свободный рабочий день.
    for m, d, transferable in sorted(_FIXED_HOLIDAYS):
        holiday = date(year, m, d)
        if not transferable or not _is_weekend(holiday):
            continue
        candidate = holiday + timedelta(days=1)
        while _is_weekend(candidate) or candidate in days_off:
            candidate += timedelta(days=1)
        days_off.add(candidate)
    return frozenset(days_off)


def is_working_day(d: date) -> bool:
    if d in EXTRA_WORKDAYS:
        return True
    if d in EXTRA_DAYS_OFF:
        return False
    return not _is_weekend(d) and d not in holidays_for_year(d.year)


def is_working_time(moment: datetime, *, timezone_name: str, start_hour: int, end_hour: int) -> bool:
    """Рабочий день по календарю и [start_hour, end_hour) по поясу компании."""
    if moment.tzinfo is None:
        raise ValueError("moment must be timezone-aware")
    local = moment.astimezone(ZoneInfo(timezone_name))
    return is_working_day(local.date()) and start_hour <= local.hour < end_hour
