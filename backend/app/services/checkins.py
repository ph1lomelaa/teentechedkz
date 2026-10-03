"""Правила ежедневного чекина: окно, статус отметки, кто обязан отмечаться.

Чистая логика без БД — фоновый цикл и эндпоинты живут отдельно (см.
checkin_notifier.py и endpoints/checkins.py). Время считается в часовом поясе
сотрудника: «10 утра» — это его локальные 10 утра, а не UTC. Пояс по
умолчанию — пояс компании; ментор в Европе выбирает свой (регламент п.2.1).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models.user import UserRole
from app.models.user_checkin import CheckinStatus

# Студенты не отмечаются — чекин про рабочий день сотрудника.
CHECKIN_ROLES = frozenset({UserRole.mentor, UserRole.mzk_manager, UserRole.academic_head})

# Короткий список вместо всех IANA-поясов: выбирать из 400 строк неудобно,
# а сотрудники работают из Казахстана и Европы. Нужен новый — добавить сюда.
CHECKIN_TIMEZONES: tuple[tuple[str, str], ...] = (
    ("Asia/Almaty", "Алматы, Астана"),
    ("Asia/Aqtobe", "Актобе, Атырау, Уральск"),
    ("Asia/Tashkent", "Ташкент"),
    ("Asia/Bishkek", "Бишкек"),
    ("Asia/Dubai", "Дубай"),
    ("Europe/Moscow", "Москва"),
    ("Europe/Istanbul", "Стамбул"),
    ("Europe/Kyiv", "Киев"),
    ("Europe/Helsinki", "Хельсинки, Рига, Вильнюс"),
    ("Europe/Warsaw", "Варшава"),
    ("Europe/Prague", "Прага"),
    ("Europe/Budapest", "Будапешт"),
    ("Europe/Vienna", "Вена"),
    ("Europe/Berlin", "Берлин"),
    ("Europe/Rome", "Рим"),
    ("Europe/Madrid", "Мадрид"),
    ("Europe/Paris", "Париж"),
    ("Europe/Amsterdam", "Амстердам"),
    ("Europe/London", "Лондон"),
)
_ALLOWED = frozenset(tz for tz, _ in CHECKIN_TIMEZONES)


def is_allowed_timezone(tz_name: str) -> bool:
    return tz_name in _ALLOWED


def user_tz(user, default_tz: str) -> str:
    """Пояс отметки сотрудника. Неизвестное значение в БД не валит цикл —
    откатываемся к поясу компании."""
    tz = getattr(user, "checkin_timezone", None)
    return tz if tz and tz in _ALLOWED else default_tz


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


def reminder_is_due(
    *,
    local_now_dt: datetime,
    hour: int,
    minute: int,
    lead_minutes: int,
) -> bool:
    """Пора напомнить заранее: [открытие − lead, открытие)."""
    opens = local_now_dt.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return opens - timedelta(minutes=lead_minutes) <= local_now_dt < opens


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
    """Рабочий день по календарю РК: выходные и праздники (с переносами) не
    требуют отметки и не портят статистику пропусками."""
    from app.services.work_calendar import is_working_day

    return is_working_day(local_day)
