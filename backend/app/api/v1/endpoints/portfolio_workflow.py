"""Individual plans, safe bulk issuance and result/document actions."""
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.audit import log_change
from app.models.activity import StudentActivity, Activity, ActivityIntake, PortfolioFocus
from app.models.document import Document, PortfolioDocumentLink
from app.models.student import Student
from app.models.user import UserRole
from app.models.roadmap import RoadmapTask, RoadmapItemStatus, TaskPriority
from app.services import learner_tasks as task_service
from app.services.mentor_scope import require_activity_student, primary_mentor_id
from app.services.notify import notify, push_notification, push_ws
from app.api.v1.endpoints.learner_tasks import CreateInput, StepInput, create_row
from app.api.v1.endpoints.activities import participation_access, participation_details, participation_details_many, mentor_options
from app.core.deps import CurrentStudent
from app.schemas.activity import FocusInput, PortfolioFocusOut, PortfolioSummary, StudentOverviewRow
from app.services.portfolio_summary import summarize
from app.api.v1.endpoints.documents import _doc_to_dict, portal_upload, upload_document

router = APIRouter(tags=['portfolio-workflow'])
DB = Annotated[AsyncSession, Depends(get_db)]

class Recipient(BaseModel):
    model_config = ConfigDict(extra='forbid')
    student_id: uuid.UUID
    steps: list[StepInput] = Field(default_factory=list, max_length=100)
    personal_deadline: date | None = None

class BulkInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    intake_id: uuid.UUID
    decision: Literal['selected', 'suggested'] = 'selected'
    recommendation_note: str | None = Field(default=None, max_length=2000)
    # A participation is unique per student/intake; a replay never adds steps twice.
    request_key: uuid.UUID
    recipients: list[Recipient] = Field(min_length=1, max_length=100)

class ResultInput(BaseModel):
    text: str = Field(min_length=1, max_length=20000)

class Verdict(BaseModel):
    action: Literal['approve', 'return']
    comment: str | None = Field(default=None, max_length=5000)

async def participation_notify(db, item, user, kind, title, *, mentor=False):
    student = await db.get(Student, item.student_id)
    recipient = (item.mentor_id or await primary_mentor_id(db, item.student_id)) if mentor else student.user_id if student else None
    if recipient:
        note = notify(db, recipient, kind=kind, title=title, body=item.recommendation_note or '', link=f"/{'workspace' if mentor else 'portal'}/activities/participations/{item.id}")
        await db.flush()
        return note
    return None

async def commit_note(db, note):
    await db.commit()
    if note:
        await db.refresh(note)
        await push_notification(note)
        await push_ws([note.user_id], 'portfolio.updated', {})

@router.post('/activities/assignments')
async def assign(body: BulkInput, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    results = []
    for recipient in body.recipients:
        note = None
        try:
            async with db.begin_nested():
                await require_activity_student(db, recipient.student_id, user)
                student = await db.get(Student, recipient.student_id)
                if not student: raise HTTPException(404, 'Ученик не найден')
                intake = await db.get(ActivityIntake, body.intake_id)
                activity = await db.get(Activity, intake.activity_id) if intake else None
                if not activity or activity.publication == 'archived': raise HTTPException(409, 'Активность недоступна')
                from app.services.task_urgency import company_today
                if intake.deadline and intake.deadline < company_today(): raise HTTPException(409, 'Набор закрыт')
                existing = (await db.execute(select(StudentActivity).where(StudentActivity.student_id == recipient.student_id, StudentActivity.intake_id == body.intake_id))).scalar_one_or_none()
                if existing:
                    results.append({'student_id': str(recipient.student_id), 'status': 'existing', 'participation_id': str(existing.id)})
                    continue
                mentors = await mentor_options(db, recipient.student_id)
                item = StudentActivity(student_id=recipient.student_id, intake_id=body.intake_id, decision=body.decision, selection_source='staff', selected_by_id=user.id, mentor_id=mentors[0]['id'] if len(mentors) == 1 else None, recommendation_note=body.recommendation_note, personal_deadline=recipient.personal_deadline)
                db.add(item)
                await db.flush()
                for i, step in enumerate(recipient.steps):
                    await create_row(db, CreateInput(**step.model_dump(), student_id=recipient.student_id, activity_participation_id=item.id), user, position=i)
                await log_change(db, 'student_activity', item.id, 'created', None, str(body.request_key), str(user.id), source='portfolio')
                note = await participation_notify(db, item, user, 'activity_assigned', 'Ментор рекомендует активность' if body.decision == 'suggested' else 'Назначена новая активность')
                await db.flush()
                result = {'student_id': str(recipient.student_id), 'status': 'created', 'participation_id': str(item.id)}
            await commit_note(db, note)
            results.append(result)
        except HTTPException as exc:
            await db.rollback()
            results.append({'student_id': str(recipient.student_id), 'status': 'error', 'message': str(exc.detail)})
        except IntegrityError:
            await db.rollback()
            existing = (await db.execute(select(StudentActivity).where(StudentActivity.student_id == recipient.student_id, StudentActivity.intake_id == body.intake_id))).scalar_one_or_none()
            results.append({'student_id': str(recipient.student_id), 'status': 'existing' if existing else 'error', 'participation_id': str(existing.id) if existing else None, 'message': None if existing else 'Не удалось сохранить план'})
    return {'results': results}

@router.get('/activities/participations/{participation_id}')
async def detail(participation_id: uuid.UUID, db: DB, user: CurrentUser):
    item = await participation_access(db, participation_id, user)
    items = await participation_details(db, item.student_id, for_student=user.role == UserRole.student)
    return next(p for p in items if p.id == participation_id)

@router.post('/activities/participations/{participation_id}/result')
async def submit_result(participation_id: uuid.UUID, body: ResultInput, db: DB, user: CurrentUser):
    if user.role != UserRole.student: raise HTTPException(403, 'Результат отправляет ученик')
    item = await participation_access(db, participation_id, user)
    if item.decision != 'selected' or item.status in ('completed', 'cancelled'): raise HTTPException(409, 'Участие не активно')
    if item.result_review_status == 'pending': return {'ok': True}
    if not body.text.strip(): raise HTTPException(422, 'Опишите результат участия')
    tasks = (await db.execute(task_service.task_query().where(RoadmapTask.activity_participation_id == item.id, RoadmapTask.deleted_at.is_(None)))).scalars().all()
    if any(t.priority == TaskPriority.required and t.status != RoadmapItemStatus.done for t in tasks): raise HTTPException(409, 'Сначала завершите обязательные шаги')
    item.result_text = body.text.strip()
    item.result_review_status = 'pending'
    item.result_submitted_at = datetime.now(timezone.utc)
    await log_change(db, 'student_activity', item.id, 'result_review_status', None, 'pending', str(user.id), source='portfolio')
    await commit_note(db, await participation_notify(db, item, user, 'activity_result_requested', 'Итог участия ждёт проверки', mentor=True))
    return {'ok': True}

@router.post('/activities/participations/{participation_id}/result/review')
async def review_result(participation_id: uuid.UUID, body: Verdict, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    item = await participation_access(db, participation_id, user)
    # Serialize competing verdicts.
    item = (await db.execute(select(StudentActivity).where(StudentActivity.id == item.id).with_for_update())).scalar_one()
    if item.result_review_status != 'pending' or item.decision != 'selected' or item.status in ('completed', 'cancelled'): raise HTTPException(409, 'Результат уже разобран или участие закрыто')
    comment = (body.comment or '').strip()
    if body.action == 'return' and not comment: raise HTTPException(422, 'Добавьте комментарий при возврате')
    item.result_review_status = 'approved' if body.action == 'approve' else 'returned'
    item.result_review_comment = comment or None
    item.result_reviewed_at = datetime.now(timezone.utc)
    item.result_reviewed_by = user.id
    if body.action == 'approve': item.status = 'completed'
    await log_change(db, 'student_activity', item.id, 'result_review_status', 'pending', item.result_review_status, str(user.id), source='portfolio')
    await commit_note(db, await participation_notify(db, item, user, 'activity_result_reviewed', 'Участие подтверждено' if body.action == 'approve' else 'Итог возвращён на правки'))
    return {'ok': True}

@router.post('/activities/participations/{participation_id}/resume')
async def resume(participation_id: uuid.UUID, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    item = await participation_access(db, participation_id, user)
    if item.status == 'completed': raise HTTPException(409, 'Участие уже завершено')
    item.decision = 'selected'
    item.status = 'in_progress'
    item.decline_reason = None
    item.result_review_status = 'none'
    await log_change(db, 'student_activity', item.id, 'resumed', None, 'selected', str(user.id), source='portfolio')
    await commit_note(db, await participation_notify(db, item, user, 'activity_resumed', 'План участия возобновлён'))
    return {'ok': True}

async def document_target(db, user, task_id, participation_id, *, write=False):
    if bool(task_id) == bool(participation_id): raise HTTPException(422, 'Выберите один шаг или участие')
    if task_id:
        task = await task_service.get_task(db, task_id, user, actionable=write)
        return task.student_id, 'evidence'
    item = await participation_access(db, participation_id, user)
    if write and (item.status == 'cancelled' or item.decision != 'selected'):
        raise HTTPException(409, 'Участие не активно')
    if user.role != UserRole.student: require_access(user, 'portfolio', Action.manage)
    return item.student_id, 'result'

class LinkInput(BaseModel):
    document_id: uuid.UUID
    task_id: uuid.UUID | None = None
    participation_id: uuid.UUID | None = None

async def link_document(db, user, body):
    sid, purpose = await document_target(db, user, body.task_id, body.participation_id, write=True)
    doc = await db.get(Document, body.document_id)
    if not doc or doc.student_id != sid or not doc.visible_to_student:
        raise HTTPException(404, 'Доступный ученику документ не найден')
    query = select(PortfolioDocumentLink).where(PortfolioDocumentLink.document_id == doc.id, PortfolioDocumentLink.task_id == body.task_id, PortfolioDocumentLink.participation_id == body.participation_id)
    if not (await db.execute(query)).scalar_one_or_none():
        async with db.begin_nested():
            db.add(PortfolioDocumentLink(document_id=doc.id, task_id=body.task_id, participation_id=body.participation_id, purpose=purpose))
            try: await db.flush()
            except IntegrityError: raise HTTPException(409, 'Документ уже прикреплён; обновите список')
        await log_change(db, 'document', doc.id, 'portfolio_link', None, str(body.task_id or body.participation_id), str(user.id), source='portfolio')
    await db.commit()
    return _doc_to_dict(doc)

@router.get('/portfolio-documents')
async def files(db: DB, user: CurrentUser, task_id: uuid.UUID | None = None, participation_id: uuid.UUID | None = None, available: bool = False):
    sid, _ = await document_target(db, user, task_id, participation_id)
    query = select(Document).where(Document.student_id == sid, Document.visible_to_student.is_(True))
    if not available:
        query = query.join(PortfolioDocumentLink, PortfolioDocumentLink.document_id == Document.id).where(PortfolioDocumentLink.task_id == task_id, PortfolioDocumentLink.participation_id == participation_id)
    return [_doc_to_dict(doc) for doc in (await db.execute(query.order_by(Document.uploaded_at.desc()))).scalars().all()]

@router.post('/portfolio-documents/link')
async def link(body: LinkInput, db: DB, user: CurrentUser):
    return await link_document(db, user, body)

@router.post('/portfolio-documents/upload')
async def upload(db: DB, user: CurrentUser, file: UploadFile = File(...), task_id: uuid.UUID | None = Form(None), participation_id: uuid.UUID | None = Form(None), doc_type: Literal['certificate', 'achievement', 'other'] = Form('other')):
    sid, _ = await document_target(db, user, task_id, participation_id, write=True)
    if user.role == UserRole.student:
        result = await portal_upload(db, user, doc_type, file)
    else:
        require_access(user, 'documents', Action.manage)
        result = await upload_document(sid, db, user, doc_type, file, None)
        doc = await db.get(Document, uuid.UUID(str(result['id'])))
        doc.visible_to_student = True
        await db.commit()
    return await link_document(db, user, LinkInput(document_id=result['id'], task_id=task_id, participation_id=participation_id))


@router.get('/activities/staff/mentors')
async def mentors(db: DB, user: CurrentUser):
    from app.models.user import User
    from app.models.mentor_assignment import MentorAssignment, MentorRole
    from app.services.mentor_scope import activity_student_ids
    require_access(user, 'portfolio', Action.manage)
    allowed = await activity_student_ids(db, user)
    query = select(User.id, User.name).join(MentorAssignment, MentorAssignment.mentor_id == User.id).where(MentorAssignment.role == MentorRole.portfolio, MentorAssignment.is_active.is_(True), MentorAssignment.assignment_status == 'active', User.is_active.is_(True))
    if allowed is not None: query = query.where(MentorAssignment.student_id.in_(allowed))
    return [{'id': row.id, 'name': row.name} for row in (await db.execute(query.distinct().order_by(User.name))).all()]


class StepOrder(BaseModel):
    task_ids: list[uuid.UUID] = Field(max_length=500)

@router.put('/activities/participations/{participation_id}/step-order')
async def reorder_steps(participation_id: uuid.UUID, body: StepOrder, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    item = await participation_access(db, participation_id, user)
    if item.status in ('completed', 'cancelled') or item.decision == 'not_interested':
        raise HTTPException(409, 'Участие закрыто')
    rows = (await db.execute(select(RoadmapTask).where(RoadmapTask.activity_participation_id == item.id, RoadmapTask.deleted_at.is_(None)).with_for_update())).scalars().all()
    if len(body.task_ids) != len(set(body.task_ids)) or set(body.task_ids) != {t.id for t in rows}:
        raise HTTPException(409, 'План изменился; обновите список шагов')
    by_id = {t.id: t for t in rows}
    for index, task_id in enumerate(body.task_ids):
        task = by_id[task_id]
        await log_change(db, 'roadmap_task', task.id, 'position', task.position, index, str(user.id), source='portfolio')
        task.position = index
        task.manual_fields = sorted(set(task.manual_fields or []) | {'position'})
    await db.commit()
    return {'ok': True}


# ---------------------------------------------------------------- сводка портфолио

async def focus_of(db, student_ids) -> dict:
    from app.models.user import User
    if not student_ids:
        return {}
    rows = (await db.execute(select(PortfolioFocus, User.name).outerjoin(User, PortfolioFocus.updated_by == User.id)
        .where(PortfolioFocus.student_id.in_(student_ids)))).all()
    return {focus.student_id: PortfolioFocusOut(text=focus.text, updated_at=focus.updated_at, updated_by_name=name) for focus, name in rows}


@router.get('/activities/my/portfolio-summary', response_model=PortfolioSummary)
async def my_summary(db: DB, student: CurrentStudent):
    items = await participation_details(db, student.id, for_student=True)
    return summarize(items, (await focus_of(db, [student.id])).get(student.id))


@router.get('/activities/students/{student_id}/portfolio-summary', response_model=PortfolioSummary)
async def student_summary(student_id: uuid.UUID, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    await require_activity_student(db, student_id, user)
    if not await db.get(Student, student_id):
        raise HTTPException(404, 'Студент не найден')
    items = await participation_details(db, student_id)
    return summarize(items, (await focus_of(db, [student_id])).get(student_id))


@router.put('/activities/students/{student_id}/portfolio-focus', response_model=PortfolioFocusOut | None)
async def set_focus(student_id: uuid.UUID, body: FocusInput, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    await require_activity_student(db, student_id, user)
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(404, 'Студент не найден')
    row = await db.get(PortfolioFocus, student_id)
    text = body.text.strip()
    old = row.text if row else None
    if old == (text or None):
        return (await focus_of(db, [student_id])).get(student_id)
    if not text:
        if row:
            await db.delete(row)
    elif row:
        row.text, row.updated_at, row.updated_by = text, datetime.now(timezone.utc), user.id
    else:
        db.add(PortfolioFocus(student_id=student_id, text=text, updated_by=user.id))
    await log_change(db, 'portfolio_focus', student_id, 'text', old, text or None, str(user.id), source='portfolio')
    note = notify(db, student.user_id, kind='portfolio_focus_updated', title='Ментор подсказал, что усилить в портфолио', body=text, link='/portal/activities') if text and student.user_id else None
    await db.commit()
    if note:
        await db.refresh(note)
        await push_notification(note)
    await push_ws([uid for uid in (user.id, student.user_id) if uid], 'portfolio.updated', {'student_id': str(student_id)})
    return (await focus_of(db, [student_id])).get(student_id)


@router.get('/activities/staff/students-overview', response_model=list[StudentOverviewRow])
async def students_overview(db: DB, user: CurrentUser, mentor_id: uuid.UUID | None = None, q: str = ''):
    """Одна строка на ученика: что у него есть, что в работе, что ждёт ментора."""
    from app.models.mentor_assignment import MentorAssignment
    from app.services.mentor_scope import activity_student_ids
    require_access(user, 'portfolio', Action.manage)
    query = select(Student.id, Student.full_name).where(Student.is_archived.is_(False))
    allowed = await activity_student_ids(db, user)
    if allowed is not None:
        query = query.where(Student.id.in_(allowed))
    if mentor_id:
        query = query.where(Student.id.in_(select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == mentor_id, MentorAssignment.is_active.is_(True), MentorAssignment.assignment_status == 'active')))
    if q.strip():
        query = query.where(Student.full_name.ilike('%' + q.strip()[:200] + '%'))
    students = (await db.execute(query.order_by(Student.full_name))).all()
    ids = [sid for sid, _ in students]
    items, focus = await participation_details_many(db, ids), await focus_of(db, ids)
    rows = []
    for sid, name in students:
        summary = summarize(items.get(sid, []), focus.get(sid))
        rows.append(StudentOverviewRow(student_id=sid, name=name, focus_set=summary.focus is not None, counts=summary.counts,
            experience_confirmed=[t.key for t in summary.experience if t.confirmed], next_deadline=summary.next_deadline))
    return rows
