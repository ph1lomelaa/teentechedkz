"""Колонка доски участий — вычисляется, отдельного поля статуса нет.

Правило одно на весь модуль: фильтры, счётчики и карточки доски читают его
отсюда. Порядок проверок важен — первое совпадение побеждает.
"""
from datetime import date, timedelta

from app.schemas.activity import StepsSummary

# Видимые колонки доски, слева направо.
BOARD_COLUMNS = ('suggested', 'planning', 'in_work', 'review', 'done')
# Колонки, где следующее действие за ментором («Ждут меня»).
MENTOR_ACTION_COLUMNS = frozenset({'planning', 'review'})
# «Срок скоро»: ближайший срок участия наступает в этом окне (или уже прошёл).
DUE_SOON_DAYS = 14


def board_column(decision: str, status: str, steps: StepsSummary) -> str:
    """closed → done → suggested → review → planning → in_work.

    `submitted` у участия означает «заявка у организатора подана» и на колонку
    не влияет: «На проверке» определяют задачи, ждущие ответа ментора.
    """
    if decision == 'not_interested' or status == 'cancelled':
        return 'closed'
    if status == 'completed':
        return 'done'
    if decision == 'suggested':
        return 'suggested'
    if steps.pending:
        return 'review'
    if not steps.total:
        return 'planning'
    return 'in_work'


def nearest_due(personal_deadline: date | None, intake_deadline: date | None, steps: StepsSummary) -> date | None:
    """Ближайший из сроков участия: личный, следующего шага, организатора."""
    dates = [d for d in (personal_deadline, intake_deadline, steps.next.due_date if steps.next else None) if d]
    return min(dates) if dates else None


def is_due_soon(column: str, due: date | None, today: date) -> bool:
    if column in ('closed', 'done') or due is None:
        return False
    return due <= today + timedelta(days=DUE_SOON_DAYS)


def needs_reminder(column: str, steps: StepsSummary, created: date, today: date) -> bool:
    """Мяч у ученика, и он застрял: просрочен шаг или рекомендация без ответа неделю."""
    if column == 'in_work':
        return steps.overdue > 0
    if column == 'suggested':
        return (today - created).days >= 7
    return False
