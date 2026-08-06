"""Фоновый цикл SLA задач менторов: напоминание → просрочка → санкция.

Правила (когда просрочено, какая ступень) живут в task_sla.py и покрыты
юнит-тестами; здесь — обход задач, уведомления и запись MentorTaskPenalty.

Идемпотентность — главное требование к этому циклу: он ходит каждые 15 минут,
и без защиты начислял бы штраф на каждом проходе. Две линии обороны:
- `sla_penalty_color` на задаче: санкция за неё уже зафиксирована и повторно
  не создаётся (ступень при этом видна прямо в задаче);
- `sla_reminded_at`: напоминание уходит ровно один раз.

Суммы берутся из reward_rules на момент фиксации — как в ручном создании
санкции (mentor_rewards.py), иначе правка ставки задним числом переписала бы
прошлые начисления.
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import func, or_, select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.mentor_task_penalty import MentorTaskPenalty, PenaltyColor
from app.models.reward_rule import RewardRuleKind
from app.models.student_task import StudentTask, TaskStatus
from app.models.user import User, UserRole
from app.services.notify import has_unread, notify, push_notification
from app.services.reward_rules import active_rules, penalty_amount_from_payload
from app.services.task_sla import (
    PAUSED_STATUSES,
    TERMINAL_STATUSES,
    is_overdue,
    month_bounds,
    needs_reminder,
    parse_ladder,
    penalty_color_for_offence,
)

logger = logging.getLogger(__name__)


async def _offence_number(db, mentor_id, now: datetime) -> int:
    """Какое это по счёту нарушение ментора за календарный месяц."""
    start, end = month_bounds(now)
    result = await db.execute(
        select(func.count(MentorTaskPenalty.id)).where(
            MentorTaskPenalty.mentor_id == mentor_id,
            MentorTaskPenalty.recorded_at >= start,
            MentorTaskPenalty.recorded_at < end,
        )
    )
    return (result.scalar() or 0) + 1


async def check_task_sla() -> None:
    db = AsyncSessionLocal()
    try:
        now = datetime.now(timezone.utc)
        # Только задачи с назначенным исполнителем и установленным SLA: санкция
        # адресуется человеку, у бесхозной задачи адресата нет.
        result = await db.execute(
            select(StudentTask).where(
                StudentTask.sla_due_at.isnot(None),
                StudentTask.assignee_id.isnot(None),
                StudentTask.status.notin_(list(TERMINAL_STATUSES | PAUSED_STATUSES)),
                or_(
                    StudentTask.sla_penalty_color.is_(None),
                    StudentTask.sla_reminded_at.is_(None),
                ),
            )
        )
        tasks = result.scalars().all()
        if not tasks:
            return

        ladder = parse_ladder(settings.TASK_SLA_PENALTY_LADDER)
        penalty_rules = await active_rules(db, RewardRuleKind.mentor_task_penalty)
        managers_result = await db.execute(
            select(User.id).where(
                User.role.in_((UserRole.admin, UserRole.mzk_manager)),
                User.is_active == True,  # noqa: E712
            )
        )
        manager_ids = [row[0] for row in managers_result.all()]

        fresh_notes = []
        breached = 0
        for task in tasks:
            task_key = f"[task:{task.id}]"

            if is_overdue(sla_due_at=task.sla_due_at, status=task.status, now=now):
                if task.sla_penalty_color is not None:
                    continue  # санкция уже зафиксирована — цикл идемпотентен
                offence = await _offence_number(db, task.assignee_id, now)
                color_value = penalty_color_for_offence(ladder, offence)
                color = PenaltyColor(color_value)
                amount = penalty_amount_from_payload(
                    penalty_rules.get(color_value), color_value
                )
                db.add(MentorTaskPenalty(
                    mentor_id=task.assignee_id,
                    task_id=task.id,
                    color=color,
                    amount=amount,
                    recorded_by=None,  # начислено автоматически, не человеком
                ))
                task.sla_penalty_color = color_value
                if task.status not in (TaskStatus.overdue,):
                    task.status = TaskStatus.overdue
                breached += 1

                fresh_notes.append(notify(
                    db, task.assignee_id,
                    kind="task_sla_breach",
                    title="Просрочена задача",
                    body=f"{task.task_text}: срок истёк, санкция {color_value} {task_key}",
                    link="/workspace/my-tasks",
                    priority="high",
                ))
                # Красная ступень — сигнал руководителю: дальше по регламенту
                # это уже разговор, а не автоматика.
                if color == PenaltyColor.red:
                    for uid in manager_ids:
                        if await has_unread(db, uid, kind="task_sla_red", body_contains=task_key):
                            continue
                        fresh_notes.append(notify(
                            db, uid,
                            kind="task_sla_red",
                            title="Красная санкция у ментора",
                            body=f"{task.task_text} {task_key}",
                            link="/workspace/mentor-tasks",
                            priority="high",
                        ))
                continue

            if needs_reminder(
                sla_due_at=task.sla_due_at,
                status=task.status,
                now=now,
                hours_before=settings.TASK_SLA_REMINDER_HOURS_BEFORE,
                already_reminded=task.sla_reminded_at is not None,
            ):
                task.sla_reminded_at = now
                fresh_notes.append(notify(
                    db, task.assignee_id,
                    kind="task_sla_warning",
                    title="Скоро истечёт срок задачи",
                    body=(
                        f"{task.task_text}: осталось меньше "
                        f"{settings.TASK_SLA_REMINDER_HOURS_BEFORE}ч {task_key}"
                    ),
                    link="/workspace/my-tasks",
                    priority="high",
                ))

        if fresh_notes or breached:
            await db.commit()
            for note in fresh_notes:
                await db.refresh(note)
                await push_notification(note)
            logger.info(
                f"Task SLA checked: {breached} newly overdue, {len(fresh_notes)} notifications"
            )
    except Exception:
        await db.rollback()
        raise
    finally:
        await db.close()


async def task_sla_loop() -> None:
    interval_seconds = settings.TASK_SLA_CHECK_INTERVAL_SECONDS
    logger.info(f"Task SLA loop starting (interval: {interval_seconds}s)")

    while True:
        try:
            await check_task_sla()
        except Exception as e:
            logger.error(f"Task SLA job failed: {e}", exc_info=True)

        await asyncio.sleep(interval_seconds)
