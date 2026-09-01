"""Единый источник правды для срочности задач — зеркало frontend/src/lib/taskUrgency.ts.

Срочность считается от due_date (дата, не время): просрочка в целых днях с полуночи
после дедлайна. Три вида задач (StudentTask, RoadmapTask, workspaceApi) используют
эту же функцию — иначе цвета разъедутся по экранам (см. ОС 30/07, Блок B).

Пороги (Прил. № 3, п. 3.4): 🟡 < 24ч · 🟠 24–48ч · 🔴 48–72ч · ⚫ > 72ч (critical,
существенное нарушение — основание расторгнуть договор).
"""
from datetime import date
from typing import Literal

from app.services.task_sla import PAUSED_STATUSES, TERMINAL_STATUSES

Urgency = Literal["none", "yellow", "orange", "red", "critical"]

# Статусы, в которых срочности нет вовсе. Раньше здесь стоял один "done", и
# отменённая или принятая задача считалась горящей — не было видно только
# потому, что эндпоинты фильтровали по status == open и до сюда её не пускали.
#
# Набор берётся из task_sla, а не переписывается литералами: срочность на
# экране обязана совпадать с тем, за что реально штрафуют. Отсюда же и пауза —
# ждущая подписи регламента задача не вина исполнителя, часы SLA на неё не
# капают, и красным её красить не за что.
#
# Значения, а не enum: сюда приходят и RoadmapTask (planned/in_progress/done),
# и StudentTask — общий знаменатель у них только строка.
NO_URGENCY_STATUSES = {status.value for status in TERMINAL_STATUSES | PAUSED_STATUSES}


def task_urgency(due_date: date | None, status: str, *, today: date | None = None) -> Urgency:
    """Срочность задачи по дедлайну и статусу.

    due_date — дата, а не datetime: просрочка отсчитывается от полуночи после
    дедлайна, то есть due_date == today ещё не просрочка (0 полных дней просрочки).
    """
    if due_date is None or status in NO_URGENCY_STATUSES:
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
