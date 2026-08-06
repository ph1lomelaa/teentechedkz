"""Правила ежедневного чекина: окно, статус отметки, кто обязан отмечаться.

Чистая логика без БД — фоновый цикл и эндпоинты живут отдельно (см.
checkin_notifier.py и endpoints/checkins.py). Время считается в часовом поясе
компании: «10 утра» — это локальные 10 утра, а не UTC.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models.user import UserRole
from app.models.user_checkin import CheckinStatus

# Студенты не отмечаются — чекин про рабочий день сотрудника.
CHECKIN_ROLES = frozenset({UserRole.mentor, UserRole.mzk_manager})


def is_checkin_role(role: UserRole) -> bool:
    return role in CHECKIN_ROLES


def local_now(tz_name: str, moment: datetime | None = None) -> datetime:
    tz = ZoneInfo(tz_name)
    base = moment or datetime.now(tz)
    return base.astimezone(tz)


def window_open_at(local_day: date, *, hour: int, minute: int, tz_name: str) -> datetime:
    return datetime.combine(local_day, time(hour, minute), tzinfo=ZoneInfo(tz_name))


def checkin_status_for(
    *,
    checked_in_local: datetime,
    hour: int,
    minute: int,
    grace_minutes: int,
) -> CheckinStatus:
    """on_time, если успел в окно [10:00, 10:00+grace]; иначе late.

    Отметка раньше открытия окна тоже считается вовремя: пришёл раньше — не
    нарушение.
    """
    opens = checked_in_local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    deadline = opens + timedelta(minutes=grace_minutes)
    return CheckinStatus.on_time if checked_in_local <= deadline else CheckinStatus.late


def window_is_closed(
    *,
    local_now_dt: datetime,
    hour: int,
    minute: int,
    window_minutes: int,
) -> bool:
    """Окно закрылось — тем, кто не отметился, ставится `missed`."""
    opens = local_now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return local_now_dt >= opens + timedelta(minutes=window_minutes)


def is_workday(local_day: date) -> bool:
    """Пн–Пт. Выходные не требуют отметки и не портят статистику пропусками."""
    return local_day.weekday() < 5
