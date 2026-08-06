"""Уведомления о критично просроченных задачах (ОС 30/07, Блок B).

>72ч просрочки — существенное нарушение (Прил. № 3, п. 3.4), основание расторгнуть
договор с ментором. Такое не должно висеть тихой плашкой у ментора — уходит Академ
Хэду (в системе это роль admin) и МЗК студента. Дедуп — по образцу
task_review_requested (roadmaps.py): identity задачи в body, has_unread перед
отправкой не плодит дубли при каждом прогоне цикла.
"""
import asyncio
import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.contract import Contract
from app.models.student import Student
from app.models.student_task import StudentTask, TaskStatus
from app.models.mentor_task_penalty import MentorTaskPenalty, PenaltyColor
from app.models.user import User, UserRole
from app.services.notify import has_unread, notify, push_notification
from app.services.task_urgency import task_urgency

logger = logging.getLogger(__name__)

_TASK_KEY_FMT = "[task:{id}]"


def violation_color_for_urgency(urgency: str) -> PenaltyColor | None:
    """Only a critical (>72h) overdue task is a formal violation."""
    return PenaltyColor.red if urgency == "critical" else None


async def check_critical_overdue_tasks() -> None:
    db = AsyncSessionLocal()
    try:
        result = await db.execute(
            select(StudentTask, Student)
            .join(Student, Student.id == StudentTask.student_id)
            .where(
                StudentTask.status.notin_((TaskStatus.accepted, TaskStatus.done, TaskStatus.cancelled)),
                StudentTask.due_date.is_not(None),
            )
        )
        rows = result.all()

        critical = [(task, student) for task, student in rows if task_urgency(task.due_date, "open") == "critical"]
        if not critical:
            return

        recipients_result = await db.execute(
            select(User.id).where(User.role == UserRole.admin, User.is_active == True)  # noqa: E712
        )
        admin_ids = [row[0] for row in recipients_result.all()]

        student_ids = {student.id for _, student in critical}
        mzk_result = await db.execute(
            select(Contract.student_id, Contract.mzk_manager_id).where(
                Contract.student_id.in_(student_ids), Contract.mzk_manager_id.is_not(None)
            )
        )
        mzk_by_student = {student_id: mzk_id for student_id, mzk_id in mzk_result.all()}

        fresh_notes = []
        for task, student in critical:
            task_key = _TASK_KEY_FMT.format(id=task.id)
            recipients = set(admin_ids)
            mzk_id = mzk_by_student.get(student.id)
            if mzk_id:
                recipients.add(mzk_id)

            existing_violation = await db.scalar(
                select(MentorTaskPenalty.id).where(MentorTaskPenalty.task_id == task.id)
            )
            assignee_role = await db.scalar(
                select(User.role).where(User.id == task.assignee_id, User.is_active == True)  # noqa: E712
            ) if task.assignee_id else None
            if not existing_violation and assignee_role in (UserRole.mentor, UserRole.mzk_manager):
                db.add(MentorTaskPenalty(
                    mentor_id=task.assignee_id,
                    task_id=task.id,
                    color=violation_color_for_urgency("critical"),
                    amount=PenaltyColor.red.amount,
                ))

            for user_id in recipients:
                if await has_unread(db, user_id, kind="task_critical_overdue", body_contains=task_key):
                    continue
                fresh_notes.append(notify(
                    db, user_id,
                    kind="task_critical_overdue",
                    title="Задача просрочена больше 72ч",
                    body=f"{student.full_name}: {task.task_text} {task_key}",
                    link=f"/workspace/students/{student.id}",
                    priority="high",
                ))

        if fresh_notes:
            await db.commit()
            for note in fresh_notes:
                await db.refresh(note)
                await push_notification(note)
            logger.info(f"Task urgency notifier sent {len(fresh_notes)} notifications")
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def task_urgency_notifier_loop() -> None:
    interval_seconds = settings.TASK_URGENCY_NOTIFICATION_INTERVAL_SECONDS
    logger.info(f"Task urgency notifier loop starting (interval: {interval_seconds}s)")

    while True:
        try:
            await check_critical_overdue_tasks()
        except Exception as e:
            logger.error(f"Task urgency notifier job failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)
