"""Правила согласованности этапа и его задач.

Этап `done` означает «все обязательные задачи приняты» — это инвариант, а не
отдельно выставляемый флаг. Раньше он держался только на проверке при
завершении этапа (PATCH /stages/{id}), а обратный переход не рассматривался
вовсе: снятие отметки с задачи внутри уже завершённого этапа оставляло этап в
`done` с незакрытой обязательной задачей.

Поэтому откат задачи каскадом откатывает и этап — иначе ментор, случайно
отметивший задачу, не мог её вернуть, не разломав картину прогресса.
"""
from __future__ import annotations

from app.models.roadmap import RoadmapItemStatus, TaskAudience, TaskPriority


def stage_status_after_task_change(
    *,
    stage_status: RoadmapItemStatus,
    required_total: int,
    required_done: int,
) -> RoadmapItemStatus:
    """Каким должен стать статус этапа после смены статуса задачи внутри него.

    Завершённый этап с незакрытой обязательной задачей возвращается в работу.
    Остальные переходы этап не трогают: доведение последней задачи до `done`
    не завершает этап автоматически — это решение ментора (в нём же висит
    проверка на допущенную команду).
    """
    if stage_status == RoadmapItemStatus.done and required_done < required_total:
        return RoadmapItemStatus.in_progress
    return stage_status


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
