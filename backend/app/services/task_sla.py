"""SLA задач менторов: дедлайн, ступени санкций, что считать просрочкой.

Здесь только чистые правила — обход задач и запись санкций живут в
task_sla_notifier.py (фоновый цикл воркера). Разделение то же, что у
task_urgency/task_urgency_notifier: правило можно проверить юнит-тестом, не
поднимая БД.

Ступени (регламент менторов, раздел 6): первое нарушение за календарный месяц
— жёлтый, второе — оранжевый, третье и далее — красный. Суммы не здесь: они
берутся из reward_rules на момент фиксации (см. mentor_rewards.py).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.student_task import TaskStatus

# Задача закрыта — SLA к ней больше не применяется.
TERMINAL_STATUSES = frozenset(
    {TaskStatus.accepted, TaskStatus.done, TaskStatus.cancelled}
)

# Ожидание подписи регламента — не вина исполнителя: работать он ещё не может,
# поэтому часы SLA на него не капают.
PAUSED_STATUSES = frozenset(
    {TaskStatus.awaiting_signature, TaskStatus.blocked_by_agreement}
)


def compute_sla_due_at(
    *, created_at: datetime, sla_hours: int | None
) -> datetime | None:
    """Момент, к которому задача должна быть сдана."""
    if not sla_hours or sla_hours <= 0:
        return None
    return created_at + timedelta(hours=sla_hours)


def is_sla_tracked(status: TaskStatus) -> bool:
    """Считаем ли SLA по задаче в этом статусе."""
    return status not in TERMINAL_STATUSES and status not in PAUSED_STATUSES


# То же правило набором — для фильтров в SQL, где функцию по строке не позвать.
# Собирается из is_sla_tracked, а не перечислением: новый статус в TaskStatus
# иначе разошёлся бы со счётчиками молча, а именно так и появился дефект, из-за
# которого «Мой день» прятал задачи в статусе overdue.
SLA_TRACKED_STATUSES = frozenset(status for status in TaskStatus if is_sla_tracked(status))


def is_overdue(
    *, sla_due_at: datetime | None, status: TaskStatus, now: datetime
) -> bool:
    if sla_due_at is None or not is_sla_tracked(status):
        return False
    return now >= sla_due_at


def needs_reminder(
    *,
    sla_due_at: datetime | None,
    status: TaskStatus,
    now: datetime,
    hours_before: int,
    already_reminded: bool,
) -> bool:
    """Напоминание за N часов до дедлайна — ровно один раз на задачу."""
    if sla_due_at is None or already_reminded or not is_sla_tracked(status):
        return False
    if now >= sla_due_at:
        return False  # уже просрочено, напоминать поздно — это другой путь
    return now >= sla_due_at - timedelta(hours=hours_before)


def penalty_color_for_offence(ladder: list[str], offence_number: int) -> str:
    """Цвет санкции за N-е нарушение: последняя ступень «залипает».

    offence_number начинается с 1. Пустая лестница недопустима — вызывающий
    обязан передать хотя бы одну ступень.
    """
    if not ladder:
        raise ValueError("ladder must not be empty")
    index = min(max(offence_number, 1), len(ladder)) - 1
    return ladder[index]


def parse_ladder(raw: str) -> list[str]:
    """`"yellow,orange,red"` → `["yellow", "orange", "red"]`."""
    return [part.strip() for part in raw.split(",") if part.strip()]


def month_bounds(moment: datetime) -> tuple[datetime, datetime]:
    """Границы календарного месяца — окно, в котором считаются нарушения."""
    start = moment.replace(
        day=1, hour=0, minute=0, second=0, microsecond=0, tzinfo=moment.tzinfo or timezone.utc
    )
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end
