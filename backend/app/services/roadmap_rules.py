"""Task priority and student visibility rules."""
from __future__ import annotations

from app.models.roadmap import TaskAudience, TaskPriority


def is_required(priority: TaskPriority) -> bool:
    return priority == TaskPriority.required


def task_visible_to_student(
    *,
    audience: TaskAudience,
    task_visible: bool,
    stage_visible: bool,
) -> bool:
    """Видит ли студент конкретную задачу.

    Три независимых условия, любое из которых скрывает задачу:
    - coordinator-задачи внутренние по своей природе (было и раньше);
    - поштучный флаг задачи — придержать задачу до нужного момента;
    - скрытый этап прячет всё внутри себя, не требуя обхода задач.
    """
    if audience != TaskAudience.applicant:
        return False
    return task_visible and stage_visible
