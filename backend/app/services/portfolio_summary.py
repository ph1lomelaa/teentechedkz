"""Сводка портфолио: «что сделать сейчас», «что уже есть», «что усилить».

Одно правило на весь модуль: раздел ученика, главная портала, карточка ученика
и обзор ментора читают сводку отсюда, поэтому видят одно и то же.
"""
from datetime import date

from app.schemas.activity import (
    ExperienceTile, NextDeadline, ParticipationDetail, PortfolioAction, PortfolioCounts,
    PortfolioFocusOut, PortfolioSummary, ShelfCell, ShelfEntry,
)
from app.services.activity_board import nearest_due
from app.services.experience import EXPERIENCE_TYPES

# Порядок «Сейчас»: правки → просрочка → рекомендации → ближайший шаг.
# Действия ученика идут раньше ожидания ментора.
ACTION_RANK = {
    'fix_step': 0, 'fix_result': 1, 'overdue_step': 2, 'decide': 3, 'submit_result': 4, 'do_step': 5,
    'plan_waiting': 6, 'step_waiting': 7, 'result_waiting': 8,
}
MENTOR_KINDS = frozenset({'plan_waiting', 'step_waiting', 'result_waiting'})


def is_open(item: ParticipationDetail) -> bool:
    return item.decision != 'not_interested' and item.status not in ('completed', 'cancelled')


def is_confirmed(item: ParticipationDetail) -> bool:
    return item.status == 'completed' and item.decision == 'selected'


def participation_action(item: ParticipationDetail, today: date) -> PortfolioAction | None:
    """Одно действие на участие — самое срочное. Закрытые участия действий не дают."""
    if not is_open(item):
        return None
    base = dict(participation_id=item.id, activity_title=item.activity.title, student_id=item.student_id, student_name=item.student_name,
                experience_type=item.activity.experience_type)
    if item.decision == 'suggested':
        return PortfolioAction(kind='decide', owner='student', due_date=item.decide_by, decide_by=item.decide_by,
                               submit_deadline=item.intake.deadline, reason=item.recommendation_note, comment_by=item.selected_by_name or item.mentor_name, **base)
    steps, step = item.steps, item.steps.next
    if item.result_review_status == 'pending':
        return PortfolioAction(kind='result_waiting', owner='mentor', **base)
    if step and step.state == 'returned':
        return PortfolioAction(kind='fix_step', owner='student', step_id=step.id, step_title=step.title, due_date=step.due_date,
                               comment=step.review_comment, comment_by=item.mentor_name, comment_at=step.reviewed_at, **base)
    if step and step.state == 'overdue':
        return PortfolioAction(kind='do_step', owner='student', step_id=step.id, step_title=step.title, due_date=step.due_date, overdue=True,
                               overdue_days=(today - step.due_date).days if step.due_date else 0, **base)
    if steps.total and steps.done >= steps.total:
        returned = item.result_review_status == 'returned'
        return PortfolioAction(kind='fix_result' if returned else 'submit_result', owner='student', due_date=item.personal_deadline,
                               comment=item.result_review_comment if returned else None, comment_by=item.mentor_name if returned else None,
                               comment_at=item.result_reviewed_at if returned else None, **base)
    if not steps.total:
        return PortfolioAction(kind='plan_waiting', owner='mentor', **base)
    if step and step.state == 'todo':
        return PortfolioAction(kind='do_step', owner='student', step_id=step.id, step_title=step.title, due_date=step.due_date, **base)
    if step and step.state == 'pending':
        return PortfolioAction(kind='step_waiting', owner='mentor', step_id=step.id, step_title=step.title, **base)
    return None


def mentor_actions(item: ParticipationDetail) -> list[PortfolioAction]:
    if not is_open(item) or item.decision != 'selected':
        return []
    base = dict(participation_id=item.id, activity_title=item.activity.title, student_id=item.student_id, student_name=item.student_name, owner='mentor')
    if item.result_review_status == 'pending':
        return [PortfolioAction(kind='result_waiting', **base)]
    if not item.steps.total:
        return [PortfolioAction(kind='plan_waiting', **base)]
    if item.steps.pending:
        step = item.steps.next if item.steps.next and item.steps.next.state == 'pending' else None
        return [PortfolioAction(kind='step_waiting', step_id=step.id if step else None, step_title=step.title if step else None, **base)]
    return []


def action_rank(action: PortfolioAction) -> int:
    return ACTION_RANK['overdue_step' if action.kind == 'do_step' and action.overdue else action.kind]


def sort_actions(actions: list[PortfolioAction]) -> list[PortfolioAction]:
    return sorted(actions, key=lambda a: (action_rank(a), a.due_date or date.max, a.activity_title))


def build_shelf(items: list[ParticipationDetail]) -> list[ShelfCell]:
    """Шесть ячеек: достижения, участия в работе и рекомендации по типу опыта."""
    cells = {key: ShelfCell(key=key, label=label, state='empty') for key, label in EXPERIENCE_TYPES if key != 'other'}
    for item in items:
        cell = cells.get(item.activity.experience_type)
        if not cell:
            continue
        entry = ShelfEntry(participation_id=item.id, title=item.activity.title)
        if is_confirmed(item):
            cell.achievements.append(entry)
        elif is_open(item) and item.decision == 'suggested':
            cell.recommended.append(entry)
        elif is_open(item):
            cell.in_work.append(entry)
    for cell in cells.values():
        cell.state = 'filled' if cell.achievements else 'in_work' if cell.in_work else 'empty'
    return list(cells.values())


def summarize(items: list[ParticipationDetail], focus: PortfolioFocusOut | None, today: date | None = None) -> PortfolioSummary:
    today = today or date.today()
    counts = PortfolioCounts()
    tiles = {key: ExperienceTile(key=key, label=label) for key, label in EXPERIENCE_TYPES}
    actions: list[PortfolioAction] = []
    waiting: list[PortfolioAction] = []
    deadline: NextDeadline | None = None
    for item in items:
        kind = item.activity.experience_type
        if is_confirmed(item):
            counts.confirmed += 1
            tiles[kind].confirmed += 1
            continue
        if not is_open(item):
            continue
        if item.decision == 'suggested':
            counts.suggested += 1
        else:
            counts.active += 1
            tiles[kind].active += 1
            counts.overdue += item.steps.overdue
            due = nearest_due(item.personal_deadline, item.intake.deadline, item.steps)
            if due and due >= today and (deadline is None or due < deadline.date):
                deadline = NextDeadline(participation_id=item.id, title=item.activity.title, date=due)
        action = participation_action(item, today)
        if action:
            actions.append(action)
            counts.waiting_student += action.owner == 'student'
        waiting.extend(mentor_actions(item))
    counts.waiting_mentor = len(waiting)
    # «Другое» показываем только когда там что-то есть: пустая плитка «Другое»
    # не подсказывает, что делать.
    experience = [t for t in tiles.values() if t.key != 'other' or t.confirmed or t.active]
    return PortfolioSummary(focus=focus, counts=counts, experience=experience, shelf=build_shelf(items), next_deadline=deadline,
                            actions=sort_actions(actions), mentor_actions=sort_actions(waiting))
