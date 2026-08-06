"""Единый источник правды для срочности задач — зеркало frontend/src/lib/taskUrgency.ts.

Срочность считается от due_date (дата, не время): просрочка в целых днях с полуночи
после дедлайна. Три вида задач (StudentTask, RoadmapTask, workspaceApi) используют
эту же функцию — иначе цвета разъедутся по экранам (см. ОС 30/07, Блок B).

Пороги (Прил. № 3, п. 3.4): 🟡 < 24ч · 🟠 24–48ч · 🔴 48–72ч · ⚫ > 72ч (critical,
существенное нарушение — основание расторгнуть договор).
"""
from datetime import date, timedelta
from typing import Literal

Urgency = Literal["none", "yellow", "orange", "red", "critical"]

DONE_STATUSES = {"done"}


def task_urgency(due_date: date | None, status: str, *, today: date | None = None) -> Urgency:
    """Срочность задачи по дедлайну и статусу.

    due_date — дата, а не datetime: просрочка отсчитывается от полуночи после
    дедлайна, то есть due_date == today ещё не просрочка (0 полных дней просрочки).
    """
    if due_date is None or status in DONE_STATUSES:
        return "none"

    reference = today or date.today()
    overdue_days = (reference - due_date).days

    if overdue_days <= 0:
        return "none"
    if overdue_days <= 1:
        return "yellow"
    if overdue_days <= 2:
        return "orange"
    if overdue_days <= 3:
        return "red"
    return "critical"
