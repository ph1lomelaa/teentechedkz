import uuid
from typing import Annotated
from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.audit import log_change
from app.models.roadmap import RoadmapTask, Stage, Roadmap, RoadmapSubtask, RoadmapItemStatus, TaskReviewStatus, TaskPriority, TaskAudience
from app.models.student import Student
from app.models.user import UserRole
from app.schemas.roadmap import TaskFlatOut, TaskReviewIn
from app.services import learner_tasks as service
from app.services.mentor_scope import require_student_access, require_activity_student
from app.services.activity_tasks import validate_activity_task

router = APIRouter(prefix='/learner-tasks', tags=['learner-tasks'])
DB = Annotated[AsyncSession, Depends(get_db)]

class StepInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default='', max_length=20000)
    expected_result: str = Field(default='', max_length=10000)
    due_date: date | None = None
    priority: TaskPriority = TaskPriority.required
    # None — решает контекст: шаг активности ученик закрывает сам (итог участия
    # ментор проверяет всегда), шаг roadmap по-прежнему идёт на проверку.
    requires_review: bool | None = None
    requires_evidence: bool = False
    needs_document: bool = False
    needs_zoom: bool = False
    subtasks: list[str] = Field(default_factory=list, max_length=100)

    @field_validator('due_date')
    @classmethod
    def valid_due(cls, value):
        if value and not date(2000, 1, 1) <= value <= date(2100, 12, 31):
            raise ValueError('Срок вне допустимого диапазона')
        return value

    @field_validator('subtasks')
    @classmethod
    def valid_checklist(cls, value):
        if any(len(s) > 500 for s in value): raise ValueError('Пункт чеклиста слишком длинный')
        return value

class CreateInput(StepInput):
    creation_key: uuid.UUID | None = None
    student_id: uuid.UUID
    stage_id: uuid.UUID | None = None
    activity_participation_id: uuid.UUID | None = None
    audience: TaskAudience = TaskAudience.applicant

class UpdateInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=20000)
    expected_result: str | None = Field(default=None, max_length=10000)
    due_date: date | None = None
    priority: TaskPriority | None = None
    requires_review: bool | None = None
    requires_evidence: bool | None = None
    position: int | None = Field(default=None, ge=0)

class CompleteInput(BaseModel):
    result_text: str | None = Field(default=None, max_length=20000)

async def create_row(db, body, user, position=None):
    if body.activity_participation_id:
        require_access(user, 'portfolio', Action.manage)
        await require_activity_student(db, body.student_id, user)
        await validate_activity_task(db, body.activity_participation_id, body.student_id)
    else:
        require_access(user, 'roadmaps', Action.edit)
        await require_student_access(db, body.student_id, user)
    if not await db.get(Student, body.student_id):
        raise HTTPException(404, 'Ученик не найден')
    stage = await db.get(Stage, body.stage_id) if body.stage_id else None
    roadmap = await db.get(Roadmap, stage.roadmap_id) if stage else None
    if body.stage_id and (not roadmap or roadmap.student_id != body.student_id or roadmap.status.value != 'active'):
        raise HTTPException(422, 'Этап недоступен для этого ученика')
    if stage:
        require_access(user, 'roadmaps', Action.edit)
    if body.creation_key:
        existing = (await db.execute(service.task_query().where(RoadmapTask.creation_key == body.creation_key))).scalar_one_or_none()
        if existing:
            await service.task_context(db, existing, user, edit=True)
            if existing.student_id != body.student_id or existing.activity_participation_id != body.activity_participation_id or existing.stage_id != body.stage_id:
                raise HTTPException(409, 'Ключ запроса уже использован')
            existing._replayed = True
            return existing
    if position is None:
        query = select(func.max(RoadmapTask.position)).where(RoadmapTask.student_id == body.student_id)
        if body.activity_participation_id: query = query.where(RoadmapTask.activity_participation_id == body.activity_participation_id)
        elif stage: query = query.where(RoadmapTask.stage_id == stage.id)
        else: query = query.where(RoadmapTask.activity_participation_id.is_(None), RoadmapTask.stage_id.is_(None))
        position = ((await db.execute(query)).scalar_one_or_none() or 0) + 1
    if not body.title.strip():
        raise HTTPException(422, 'Название не может быть пустым')
    values = body.model_dump(exclude={'subtasks', 'stage_id'})
    if values['requires_review'] is None:
        values['requires_review'] = not body.activity_participation_id
    row = RoadmapTask(**{**values, 'title': body.title.strip()}, stage_id=stage.id if stage else None, roadmap_id=roadmap.id if roadmap else None, created_by=user.id, position=position if position is not None else 0)
    row.subtasks = [RoadmapSubtask(title=title.strip(), position=i) for i, title in enumerate(body.subtasks) if title.strip()]
    db.add(row)
    await db.flush()
    await log_change(db, 'roadmap_task', row.id, 'created', None, row.title, str(user.id), source='portfolio')
    return row

@router.post('', response_model=TaskFlatOut, status_code=201)
async def create(body: CreateInput, db: DB, user: CurrentUser):
    try:
        row = await create_row(db, body, user)
    except IntegrityError:
        await db.rollback()
        if not body.creation_key: raise
        row = (await db.execute(service.task_query().where(RoadmapTask.creation_key == body.creation_key))).scalar_one_or_none()
        if not row: raise
        await service.task_context(db, row, user, edit=True)
        if row.student_id != body.student_id or row.activity_participation_id != body.activity_participation_id or row.stage_id != body.stage_id:
            raise HTTPException(409, 'Ключ запроса уже использован')
        row._replayed = True
    if not getattr(row, '_replayed', False):
        await service.emit_task(db, row, user, 'task_assigned', 'Новая задача')
    return await service.flat_task(db, row)

@router.get('/{task_id}', response_model=TaskFlatOut)
async def detail(task_id: uuid.UUID, db: DB, user: CurrentUser):
    return await service.flat_task(db, await service.get_task(db, task_id, user))

@router.patch('/{task_id}', response_model=TaskFlatOut)
async def update(task_id: uuid.UUID, body: UpdateInput, db: DB, user: CurrentUser):
    row = await service.get_task(db, task_id, user, edit=True, actionable=True)
    if row.review_status == TaskReviewStatus.pending:
        raise HTTPException(409, 'Сначала разберите отправленную работу')
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is None and field != 'due_date':
            raise HTTPException(422, 'Поле не может быть пустым')
        if field == 'title' and not value.strip():
            raise HTTPException(422, 'Название не может быть пустым')
        old = getattr(row, field)
        setattr(row, field, value)
        await log_change(db, 'roadmap_task', row.id, field, old, value, str(user.id), source='portfolio')
    edited = set(data) & {'title', 'description', 'expected_result', 'priority', 'due_date', 'position'}
    if edited:
        row.manual_fields = sorted(set(row.manual_fields or []) | edited)
    await db.commit()
    return await service.flat_task(db, row)

@router.delete('/{task_id}', status_code=204)
async def remove(task_id: uuid.UUID, db: DB, user: CurrentUser):
    row = await service.get_task(db, task_id, user, edit=True, actionable=True)
    row.deleted_at = datetime.now(timezone.utc)
    await log_change(db, 'roadmap_task', row.id, 'deleted_at', None, row.deleted_at.isoformat(), str(user.id), source='portfolio')
    await db.commit()

@router.post('/{task_id}/start', response_model=TaskFlatOut)
async def start(task_id: uuid.UUID, db: DB, user: CurrentUser):
    row = await service.get_task(db, task_id, user, actionable=True)
    if user.role != UserRole.student or row.status == RoadmapItemStatus.done or row.review_status == TaskReviewStatus.pending:
        raise HTTPException(409, 'Нельзя начать этот шаг')
    row.status = RoadmapItemStatus.in_progress
    if row.activity_participation_id:
        from app.models.activity import StudentActivity
        item = await db.get(StudentActivity, row.activity_participation_id)
        if item.status == 'not_started': item.status = 'in_progress'
    await db.commit()
    return await service.flat_task(db, row)

@router.post('/{task_id}/complete', response_model=TaskFlatOut)
async def complete(task_id: uuid.UUID, body: CompleteInput, db: DB, user: CurrentUser):
    row = await service.get_task(db, task_id, user, actionable=True)
    await service.complete(db, row, user, body.result_text)
    return await service.flat_task(db, row)

@router.post('/{task_id}/review', response_model=TaskFlatOut)
async def review(task_id: uuid.UUID, body: TaskReviewIn, db: DB, user: CurrentUser):
    row = await service.get_task(db, task_id, user, edit=True, actionable=True)
    await service.review(db, row, user, body.action, body.comment)
    return await service.flat_task(db, row)

@router.patch('/{task_id}/checklist/{subtask_id}', response_model=TaskFlatOut)
async def checklist(task_id: uuid.UUID, subtask_id: uuid.UUID, db: DB, user: CurrentUser, done: bool):
    row = await service.get_task(db, task_id, user, actionable=True)
    if row.status == RoadmapItemStatus.done or row.review_status == TaskReviewStatus.pending:
        raise HTTPException(409, 'Шаг уже выполнен или отправлен')
    sub = next((s for s in row.subtasks if s.id == subtask_id and s.deleted_at is None), None)
    if not sub: raise HTTPException(404, 'Пункт не найден')
    sub.is_done = done
    await db.commit()
    return await service.flat_task(db, row)
