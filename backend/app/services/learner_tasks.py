"""Shared ownership, visibility and lifecycle for student-facing work."""
import uuid
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, or_, and_, inspect
from sqlalchemy.orm import selectinload
from app.core.audit import log_change
from app.core.permissions import Action, require_access
from app.models.activity import StudentActivity, ActivityIntake, Activity
from app.models.document import Document, PortfolioDocumentLink
from app.models.roadmap import RoadmapTask, Stage, Roadmap, RoadmapStatus, TaskAudience, RoadmapItemStatus, TaskReviewStatus, TaskSubmission
from app.models.student import Student
from app.models.user import UserRole
from app.schemas.roadmap import RoadmapTaskOut, TaskFlatOut
from app.services.mentor_scope import require_student_access, require_activity_student, primary_mentor_id
from app.services.notify import notify, push_notification, push_ws


def task_query():
    return select(RoadmapTask).options(selectinload(RoadmapTask.subtasks))


async def task_context(db, task, user, *, edit=False, actionable=False):
    sid = task.student_id
    roadmap = await db.get(Roadmap, task.roadmap_id) if task.roadmap_id else None
    if sid is None and roadmap:
        sid = roadmap.student_id
    if not sid or task.deleted_at is not None:
        raise HTTPException(404, 'Задача не найдена')
    participation = await db.get(StudentActivity, task.activity_participation_id) if task.activity_participation_id else None
    if user.role == UserRole.student:
        own = (await db.execute(select(Student.id).where(Student.user_id == user.id))).scalar_one_or_none()
        stage = await db.get(Stage, task.stage_id) if task.stage_id else None
        if own != sid or task.audience != TaskAudience.applicant or not task.visible_to_student or (stage and not stage.visible_to_student):
            raise HTTPException(404, 'Задача не найдена')
        if edit:
            raise HTTPException(403, 'Изменение плана доступно ментору')
    elif participation:
        require_access(user, 'portfolio', Action.manage)
        await require_activity_student(db, sid, user)
    else:
        require_access(user, 'roadmaps', Action.edit if edit or actionable else Action.view)
        await require_student_access(db, sid, user)
    if actionable:
        if roadmap and roadmap.status != RoadmapStatus.active:
            raise HTTPException(409, 'Roadmap в архиве')
        if participation and (participation.status in ('completed', 'cancelled') or (participation.decision == 'not_interested' or (user.role == UserRole.student and participation.decision != 'selected'))):
            raise HTTPException(409, 'Участие не активно')
    return sid, roadmap, participation


async def get_task(db, task_id, user, **kwargs):
    task = (await db.execute(task_query().where(RoadmapTask.id == task_id).with_for_update())).scalar_one_or_none()
    if not task:
        raise HTTPException(404, 'Задача не найдена')
    await task_context(db, task, user, **kwargs)
    return task


async def flat_task(db, task):
    if 'subtasks' in inspect(task).unloaded:
        await db.refresh(task, ['subtasks'])
    stage = await db.get(Stage, task.stage_id) if task.stage_id else None
    name = 'Самостоятельные задачи'
    if task.activity_participation_id:
        title = (await db.execute(select(Activity.title).join(ActivityIntake).join(StudentActivity, StudentActivity.intake_id == ActivityIntake.id).where(StudentActivity.id == task.activity_participation_id))).scalar_one_or_none()
        name = title or 'Активность'
    elif stage:
        name = stage.name
    values = RoadmapTaskOut.model_validate(task).model_dump()
    return TaskFlatOut(**values, stage_name=name, stage_position=stage.position if stage else 9999)


async def student_tasks(db, sid, *, for_student):
    query = task_query().outerjoin(Roadmap, RoadmapTask.roadmap_id == Roadmap.id).outerjoin(Stage, RoadmapTask.stage_id == Stage.id).outerjoin(StudentActivity, RoadmapTask.activity_participation_id == StudentActivity.id).where(
        RoadmapTask.student_id == sid, RoadmapTask.deleted_at.is_(None),
        or_(RoadmapTask.roadmap_id.is_(None), Roadmap.status == RoadmapStatus.active),
        or_(RoadmapTask.activity_participation_id.is_(None), and_(StudentActivity.decision == 'selected', StudentActivity.status != 'cancelled')))
    if for_student:
        query = query.where(RoadmapTask.audience == TaskAudience.applicant, RoadmapTask.visible_to_student.is_(True), or_(RoadmapTask.stage_id.is_(None), Stage.visible_to_student.is_(True)))
    tasks = (await db.execute(query.order_by(RoadmapTask.due_date.asc().nullslast(), RoadmapTask.position))).scalars().all()
    return [await flat_task(db, task) for task in tasks]


async def emit_task(db, task, user, kind, title, *, mentor=False, silent=False):
    student = await db.get(Student, task.student_id)
    participation = await db.get(StudentActivity, task.activity_participation_id) if task.activity_participation_id else None
    recipient = ((participation.mentor_id if participation else None) or await primary_mentor_id(db, task.student_id)) if mentor else (student.user_id if student else None)
    note = None
    if recipient and not silent:
        link = f'/workspace/activities/participations/{participation.id}' if mentor and participation else '/workspace/tasks?view=review' if mentor else f'/portal/activities/participations/{participation.id}' if participation else f'/portal/tasks?task_id={task.id}'
        note = notify(db, recipient, kind=kind, title=title, body=task.title, link=link)
    await db.commit()
    if note:
        await db.refresh(note)
        await push_notification(note)
    await push_ws([uid for uid in (user.id, recipient) if uid], 'roadmap.updated', {'student_id': str(task.student_id), 'roadmap_id': str(task.roadmap_id) if task.roadmap_id else None})


async def complete(db, task, user, result_text=None):
    if user.role != UserRole.student:
        raise HTTPException(403, 'Доступно ученику')
    await task_context(db, task, user, actionable=True)
    if task.status == RoadmapItemStatus.done or task.review_status == TaskReviewStatus.pending:
        return task
    if task.requires_evidence:
        evidence = (await db.execute(select(Document.id).join(PortfolioDocumentLink, PortfolioDocumentLink.document_id == Document.id).where(PortfolioDocumentLink.task_id == task.id, Document.student_id == task.student_id, Document.visible_to_student.is_(True)).limit(1))).scalar_one_or_none()
        if evidence is None:
            raise HTTPException(422, 'Прикрепите обязательное подтверждение')
    task.result_text = result_text if result_text is not None else task.result_text
    if task.activity_participation_id:
        participation = await db.get(StudentActivity, task.activity_participation_id)
        if participation and participation.status == 'not_started':
            participation.status = 'in_progress'
            await log_change(db, 'student_activity', participation.id, 'status', 'not_started', 'in_progress', str(user.id), source='portfolio')
    old = task.review_status.value
    task.completed_at = datetime.now(timezone.utc)
    task.completed_by = user.id
    task.review_status = TaskReviewStatus.pending if task.requires_review else TaskReviewStatus.none
    task.status = RoadmapItemStatus.in_progress if task.requires_review else RoadmapItemStatus.done
    await log_change(db, 'roadmap_task', task.id, 'review_status', old, task.review_status.value, str(user.id), source='portfolio')
    await log_change(db, 'roadmap_task', task.id, 'status', None, task.status.value, str(user.id), source='portfolio')
    if task.requires_review:
        # Снимок отправки: что было приложено сейчас. Файлы потом могут смениться.
        files = (await db.execute(select(PortfolioDocumentLink.document_id).where(PortfolioDocumentLink.task_id == task.id))).scalars().all()
        db.add(TaskSubmission(task_id=task.id, submitted_by=user.id, submitted_at=task.completed_at, note=task.result_text,
                              document_ids=[str(doc_id) for doc_id in files]))
    # Шаг активности без проверки — обычный прогресс: ментор видит его на доске и в
    # карточке, отдельное уведомление на каждый такой шаг было бы шумом.
    await emit_task(db, task, user, 'task_review_requested' if task.requires_review else 'task_completed', 'Работа отправлена на проверку' if task.requires_review else 'Ученик выполнил шаг', mentor=True,
                    silent=not task.requires_review and bool(task.activity_participation_id))
    return task


async def review(db, task, user, action, comment):
    await task_context(db, task, user, edit=True, actionable=True)
    if task.review_status != TaskReviewStatus.pending:
        raise HTTPException(409, 'Работа уже разобрана')
    if action not in ('approve', 'return') or (action == 'return' and not (comment or '').strip()):
        raise HTTPException(422, 'При возврате нужен комментарий')
    task.review_status = TaskReviewStatus.approved if action == 'approve' else TaskReviewStatus.returned
    task.status = RoadmapItemStatus.done if action == 'approve' else RoadmapItemStatus.in_progress
    task.review_comment = (comment or '').strip() or None
    task.reviewed_by = user.id
    task.reviewed_at = datetime.now(timezone.utc)
    submission = (await db.execute(select(TaskSubmission).where(TaskSubmission.task_id == task.id, TaskSubmission.verdict == 'pending')
        .order_by(TaskSubmission.submitted_at.desc()).limit(1))).scalar_one_or_none()
    if submission:
        submission.verdict = 'accepted' if action == 'approve' else 'returned'
        submission.review_comment, submission.reviewed_by, submission.reviewed_at = task.review_comment, user.id, task.reviewed_at
    await log_change(db, 'roadmap_task', task.id, 'review_status', 'pending', task.review_status.value, str(user.id), source='portfolio')
    await emit_task(db, task, user, 'task_approved' if action == 'approve' else 'task_returned', 'Ментор принял работу' if action == 'approve' else 'Нужны правки')
    return task


async def submissions_by_task(db, task_ids) -> dict:
    """Отправки шагов, новые сверху, с именами файлов и проверяющего."""
    from app.models.user import User
    from app.schemas.activity import SubmissionFile, SubmissionOut
    if not task_ids:
        return {}
    rows = (await db.execute(select(TaskSubmission, User.name).outerjoin(User, TaskSubmission.reviewed_by == User.id)
        .where(TaskSubmission.task_id.in_(task_ids)).order_by(TaskSubmission.submitted_at.desc()))).all()
    doc_ids = {doc_id for submission, _ in rows for doc_id in submission.document_ids or []}
    names = {}
    if doc_ids:
        documents = (await db.execute(select(Document.id, Document.display_name, Document.file_name).where(Document.id.in_([uuid.UUID(doc_id) for doc_id in doc_ids])))).all()
        names = {str(doc_id): display or file for doc_id, display, file in documents}
    grouped: dict = {}
    for submission, reviewer in rows:
        grouped.setdefault(str(submission.task_id), []).append(SubmissionOut(
            id=submission.id, submitted_at=submission.submitted_at, note=submission.note, verdict=submission.verdict,
            files=[SubmissionFile(id=doc_id, name=names[doc_id]) for doc_id in submission.document_ids or [] if doc_id in names],
            review_comment=submission.review_comment, reviewer_name=reviewer, reviewed_at=submission.reviewed_at))
    return grouped
