"""Activity catalogue and student-owned participation. No external registration is performed."""
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, exists, select, func, or_
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import CurrentStudent, CurrentUser
from app.core.permissions import Action, require_access
from app.models.activity import Activity, ActivityIntake, StudentActivity
from app.models.student import Student
from app.models.user import User, UserRole
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.roadmap import RoadmapItemStatus, RoadmapStatus, RoadmapTask, Roadmap, Stage, TaskPriority, TaskReviewStatus
from app.schemas.roadmap import RoadmapTaskOut
from app.schemas.activity import ParticipationEdit, MyParticipationEdit, ActivityTaskLink, StaffParticipationCreate, BoardItem
from app.core.audit import log_change
from app.services.roadmap_rules import task_visible_to_student
from app.services.activity_tasks import validate_activity_task
from app.schemas.activity import ActivityCard, ActivityCreate, ActivityOut, IntakeCreate, IntakeOut, ParticipationCreate, ParticipationOut, ParticipationDetail, StepsSummary, NextStep
from app.services.task_urgency import overdue_days
from app.services.mentor_scope import activity_student_ids, require_activity_student
from app.services.activity_board import MENTOR_ACTION_COLUMNS, board_column, is_due_soon, nearest_due, needs_reminder

router = APIRouter(prefix='/activities', tags=['activities'])
DB = Annotated[AsyncSession, Depends(get_db)]


def require_catalog_admin(user):
    """Только импорт Excel: разовая загрузка базы, её делает администратор."""
    if user.role != UserRole.admin:
        raise HTTPException(403, 'Импорт каталога доступен администратору')


def require_catalog_editor(user):
    require_access(user, 'activity_catalog', Action.manage)


async def student_has_activity(db, user, activity_id) -> bool:
    """Черновик виден ученику, только если ему его адресно рекомендовали."""
    return (await db.execute(select(StudentActivity.id)
        .join(ActivityIntake, StudentActivity.intake_id == ActivityIntake.id)
        .join(Student, StudentActivity.student_id == Student.id)
        .where(Student.user_id == user.id, ActivityIntake.activity_id == activity_id).limit(1))).first() is not None


async def visible_activity(db, activity_id, user):
    if user.role != UserRole.student:
        require_access(user, 'portfolio', Action.manage)
    activity = await db.get(Activity, activity_id)
    if not activity or (user.role == UserRole.student and activity.publication != 'published'
                        and not await student_has_activity(db, user, activity_id)):
        raise HTTPException(404, 'Активность не найдена')
    return activity


def activity_values(body: ActivityCreate) -> dict:
    values = body.model_dump()
    if values.get('source_url') is not None:
        values['source_url'] = str(values['source_url'])
    return values


def review_issues(activity: Activity, intakes: list[ActivityIntake], near: ActivityIntake | None) -> list[str]:
    """Чего не хватает записи, чтобы ученик не получил выдуманных условий."""
    issues = []
    if not activity.source_url:
        issues.append('Нет ссылки организатора')
    if not (activity.description or '').strip():
        issues.append('Нет описания')
    if not intakes:
        issues.append('Нет наборов')
    elif all(i.mode == 'unknown' and not i.deadline for i in intakes):
        issues.append('Сроки не уточнены')
    if intakes and (near or intakes[0]).cost_state == 'unknown':
        issues.append('Стоимость не уточнена')
    return issues


def nearest_intake(intakes: list[ActivityIntake], today: date) -> ActivityIntake | None:
    """Набор для карточки каталога: ближайший будущий дедлайн, иначе постоянный
    набор, иначе любой. Прошедшие дедлайны не выдаём за действующие."""
    upcoming = sorted((i for i in intakes if i.deadline and i.deadline >= today), key=lambda i: i.deadline)
    if upcoming:
        return upcoming[0]
    open_ended = [i for i in intakes if i.mode in ('rolling', 'self_paced') and not i.deadline]
    if open_ended:
        return open_ended[0]
    undated = [i for i in intakes if not i.deadline]
    return undated[0] if undated else None


@router.get('', response_model=list[ActivityCard])
async def list_activities(db: DB, current_user: CurrentUser, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100)):
    if current_user.role != UserRole.student:
        require_access(current_user, 'portfolio', Action.manage)
    query = select(Activity)
    if current_user.role == UserRole.student:
        # Ученик видит опубликованное с открытым или неизвестным набором:
        # есть набор без даты или с будущей датой, либо наборов ещё нет.
        any_intake = exists().where(ActivityIntake.activity_id == Activity.id)
        open_intake = exists().where(and_(ActivityIntake.activity_id == Activity.id,
            or_(ActivityIntake.deadline.is_(None), ActivityIntake.deadline >= date.today())))
        query = query.where(Activity.publication == 'published', or_(open_intake, ~any_intake))
    activities = (await db.execute(query.order_by(Activity.created_at.desc(), Activity.id).offset(offset).limit(limit))).scalars().all()
    intakes: dict[uuid.UUID, list[ActivityIntake]] = {}
    if activities:
        for intake in (await db.execute(select(ActivityIntake).where(ActivityIntake.activity_id.in_([a.id for a in activities])))).scalars():
            intakes.setdefault(intake.activity_id, []).append(intake)
    today = date.today()
    cards = []
    staff = current_user.role != UserRole.student
    for activity in activities:
        own = intakes.get(activity.id, [])
        near = nearest_intake(own, today)
        cards.append(ActivityCard(**ActivityOut.model_validate(activity).model_dump(),
                                  next_intake=IntakeOut.model_validate(near) if near else None,
                                  intake_count=len(own),
                                  review_issues=review_issues(activity, own, near) if staff else []))
    return cards


@router.post('', response_model=ActivityOut, status_code=201)
async def create_activity(body: ActivityCreate, db: DB, current_user: CurrentUser):
    require_catalog_editor(current_user)
    activity = Activity(**activity_values(body))
    db.add(activity)
    await db.commit()
    await db.refresh(activity)
    return activity


@router.put('/{activity_id}', response_model=ActivityOut)
async def update_activity(activity_id: uuid.UUID, body: ActivityCreate, db: DB, current_user: CurrentUser):
    require_catalog_editor(current_user)
    activity = await visible_activity(db, activity_id, current_user)
    for key, value in activity_values(body).items():
        setattr(activity, key, value)
    await db.commit()
    await db.refresh(activity)
    return activity


@router.get('/{activity_id}/intakes', response_model=list[IntakeOut])
async def list_intakes(activity_id: uuid.UUID, db: DB, current_user: CurrentUser):
    await visible_activity(db, activity_id, current_user)
    return (await db.execute(select(ActivityIntake).where(ActivityIntake.activity_id == activity_id).order_by(ActivityIntake.label, ActivityIntake.id))).scalars().all()


@router.post('/{activity_id}/intakes', response_model=IntakeOut, status_code=201)
async def create_intake(activity_id: uuid.UUID, body: IntakeCreate, db: DB, current_user: CurrentUser):
    require_catalog_editor(current_user)
    await visible_activity(db, activity_id, current_user)
    intake = ActivityIntake(activity_id=activity_id, **body.model_dump())
    db.add(intake)
    await db.commit()
    await db.refresh(intake)
    return intake


async def select_participation(db, student_id, body, *, allow_draft=False, source='unknown', actor_id=None):
    intake = await db.get(ActivityIntake, body.intake_id)
    activity = await db.get(Activity, intake.activity_id) if intake else None
    if not activity or activity.publication == 'archived' or (activity.publication == 'draft' and not allow_draft):
        raise HTTPException(404, 'Набор недоступен для выбора')
    query = select(StudentActivity).where(StudentActivity.student_id == student_id, StudentActivity.intake_id == body.intake_id)
    existing = (await db.execute(query)).scalar_one_or_none()
    if existing:
        return existing
    if intake.deadline and intake.deadline < date.today():
        raise HTTPException(409, 'Набор закрыт')
    # Ментор портфолио у ученика один — он и ведёт участие. Если их несколько,
    # не угадываем: ответственного выберут в плане.
    mentors = await mentor_options(db, student_id)
    participation = StudentActivity(student_id=student_id, intake_id=body.intake_id, goal=body.goal,
        decision=getattr(body, 'decision', 'selected'), selection_source=source, selected_by_id=actor_id,
        recommendation_note=getattr(body, 'recommendation_note', None),
        personal_deadline=getattr(body, 'personal_deadline', None),
        mentor_id=mentors[0]['id'] if len(mentors) == 1 else None)
    db.add(participation)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = (await db.execute(query)).scalar_one_or_none()
        if existing:
            return existing
        raise
    await db.refresh(participation)
    return participation


_NEXT_ORDER = {'returned': 0, 'overdue': 1, 'todo': 2, 'pending': 3}


def task_state(task: RoadmapTask, today: date | None = None) -> str:
    if task.status == RoadmapItemStatus.done:
        return 'done'
    if task.review_status == TaskReviewStatus.pending:
        return 'pending'
    if task.review_status == TaskReviewStatus.returned:
        return 'returned'
    if overdue_days(task.due_date, done=False, today=today) > 0:
        return 'overdue'
    return 'todo'


def summarize_steps(tasks: list[RoadmapTask], today: date | None = None) -> StepsSummary:
    """Прогресс по шагам участия. Необязательные задачи не входят в знаменатель —
    дополнительная работа не должна выглядеть как отставание."""
    summary = StepsSummary()
    candidates = []
    for task in tasks:
        state = task_state(task, today)
        if task.priority != TaskPriority.optional:
            summary.total += 1
            summary.done += state == 'done'
        if task.priority != TaskPriority.optional:
            summary.segment_states.append('done' if state == 'done' else 'pending' if state == 'pending' else 'todo')
        summary.pending += state == 'pending'
        summary.returned += state == 'returned'
        summary.overdue += state == 'overdue'
        if state != 'done':
            candidates.append((_NEXT_ORDER[state], task.due_date or date.max, task.position, task, state))
    if candidates:
        *_, task, state = min(candidates, key=lambda c: c[:3])
        summary.next = NextStep(id=task.id, title=task.title, due_date=task.due_date, state=state,
                                submitted_at=getattr(task, 'completed_at', None) if state == 'pending' else None)
    return summary


async def steps_by_participation(db, participation_ids, *, for_student: bool) -> dict:
    if not participation_ids:
        return {}
    rows = (await db.execute(select(RoadmapTask, Stage.visible_to_student, Roadmap.status)
        .join(Stage, RoadmapTask.stage_id == Stage.id).join(Roadmap, RoadmapTask.roadmap_id == Roadmap.id)
        .where(RoadmapTask.activity_participation_id.in_(participation_ids), RoadmapTask.deleted_at.is_(None)))).all()
    grouped: dict[uuid.UUID, list[RoadmapTask]] = {}
    for task, stage_visible, roadmap_status in rows:
        if for_student and not (roadmap_status == RoadmapStatus.active and task_visible_to_student(
                audience=task.audience, task_visible=task.visible_to_student, stage_visible=stage_visible)):
            continue
        grouped.setdefault(task.activity_participation_id, []).append(task)
    return {pid: summarize_steps(sorted(tasks, key=lambda t: (t.position, str(t.id)))) for pid, tasks in grouped.items()}


def participation_rows():
    """Участие с набором, активностью, именами ментора, ученика и того, кто выбрал."""
    selector = aliased(User)
    return (select(StudentActivity, ActivityIntake, Activity, User.name, Student.full_name, selector.name)
        .join(ActivityIntake, StudentActivity.intake_id == ActivityIntake.id)
        .join(Activity, ActivityIntake.activity_id == Activity.id)
        .outerjoin(User, StudentActivity.mentor_id == User.id)
        .outerjoin(selector, StudentActivity.selected_by_id == selector.id)
        .join(Student, StudentActivity.student_id == Student.id))


async def participation_details(db, student_id, *, for_student: bool = False):
    rows = (await db.execute(participation_rows()
        .where(StudentActivity.student_id == student_id)
        .order_by(StudentActivity.created_at.desc()))).all()
    steps = await steps_by_participation(db, [row[0].id for row in rows], for_student=for_student)
    # Участие без ответственного, а ментор портфолио у ученика один — показываем
    # его, а не «не назначен»: ученик не должен думать, что его бросили.
    fallback = None
    if any(row[0].mentor_id is None for row in rows):
        mentors = await mentor_options(db, student_id)
        fallback = mentors[0]['name'] if len(mentors) == 1 else None
    return [ParticipationDetail(**ParticipationOut.model_validate(item).model_dump(),
        activity=ActivityOut.model_validate(activity), intake=IntakeOut.model_validate(intake),
        mentor_name=mentor_name or (fallback if item.mentor_id is None else None), student_name=student_name,
        selected_by_name=selected_by, steps=steps.get(item.id, StepsSummary()))
        for item, intake, activity, mentor_name, student_name, selected_by in rows]


@router.get('/my/participations', response_model=list[ParticipationDetail])
async def my_participations(db: DB, student: CurrentStudent):
    return await participation_details(db, student.id, for_student=True)


@router.post('/my/participations', response_model=ParticipationOut)
async def select_my_activity(body: ParticipationCreate, db: DB, student: CurrentStudent):
    return await select_participation(db, student.id, body, source='student', actor_id=student.user_id)


@router.get('/students/{student_id}/participations', response_model=list[ParticipationDetail])
async def student_participations(student_id: uuid.UUID, db: DB, current_user: CurrentUser):
    require_access(current_user, 'portfolio', Action.manage)
    await require_activity_student(db, student_id, current_user)
    if not await db.get(Student, student_id):
        raise HTTPException(404, 'Студент не найден')
    return await participation_details(db, student_id)


@router.post('/students/{student_id}/participations', response_model=ParticipationOut)
async def select_student_activity(student_id: uuid.UUID, body: StaffParticipationCreate, db: DB, current_user: CurrentUser):
    require_access(current_user, 'portfolio', Action.manage)
    await require_activity_student(db, student_id, current_user)
    if not await db.get(Student, student_id):
        raise HTTPException(404, 'Студент не найден')
    return await select_participation(db, student_id, body, allow_draft=True, source='staff', actor_id=current_user.id)


@router.get('/{activity_id}', response_model=ActivityOut)
async def get_activity(activity_id: uuid.UUID, db: DB, current_user: CurrentUser):
    return await visible_activity(db, activity_id, current_user)


@router.put('/{activity_id}/intakes/{intake_id}', response_model=IntakeOut)
async def update_intake(activity_id: uuid.UUID, intake_id: uuid.UUID, body: IntakeCreate, db: DB, current_user: CurrentUser):
    require_catalog_editor(current_user)
    await visible_activity(db, activity_id, current_user)
    intake = await db.get(ActivityIntake, intake_id)
    if not intake or intake.activity_id != activity_id:
        raise HTTPException(404, 'Набор не найден')
    for key, value in body.model_dump().items():
        setattr(intake, key, value)
    await db.commit()
    await db.refresh(intake)
    return intake


async def participation_access(db, participation_id, user):
    item = await db.get(StudentActivity, participation_id)
    if not item:
        raise HTTPException(404, 'Участие не найдено')
    if user.role == UserRole.student:
        student = (await db.execute(select(Student.id).where(Student.user_id == user.id))).scalar_one_or_none()
        if item.student_id != student:
            raise HTTPException(404, 'Участие не найдено')
    else:
        require_access(user, 'portfolio', Action.manage)
        await require_activity_student(db, item.student_id, user)
    return item


async def mentor_options(db, student_id):
    users = (await db.execute(select(User).join(MentorAssignment, MentorAssignment.mentor_id == User.id)
        .where(MentorAssignment.student_id == student_id, MentorAssignment.role == MentorRole.portfolio,
            MentorAssignment.is_active.is_(True), MentorAssignment.assignment_status == 'active', User.is_active.is_(True)))).scalars().all()
    return [dict(id=user.id, name=user.name) for user in users]


@router.get('/participations/{participation_id}/mentors')
async def participation_mentors(participation_id: uuid.UUID, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    item = await participation_access(db, participation_id, user)
    return await mentor_options(db, item.student_id)


async def edit_participation(db, item, data, user):
    for key, value in data.items():
        old = getattr(item, key)
        if old != value:
            setattr(item, key, value)
            await log_change(db, 'student_activity', item.id, key, old, value, str(user.id), source='portfolio')
    await db.commit()
    await db.refresh(item)
    return item


@router.patch('/participations/{participation_id}', response_model=ParticipationOut)
async def update_participation(participation_id: uuid.UUID, body: ParticipationEdit, db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    item = await participation_access(db, participation_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get('mentor_id') and data['mentor_id'] not in {m['id'] for m in await mentor_options(db, item.student_id)}:
        raise HTTPException(422, 'Выберите активного ментора портфолио, назначенного ученику')
    return await edit_participation(db, item, data, user)


@router.patch('/my/participations/{participation_id}', response_model=ParticipationOut)
async def update_my_participation(participation_id: uuid.UUID, body: MyParticipationEdit, db: DB, user: CurrentUser):
    if user.role != UserRole.student:
        raise HTTPException(403, 'Доступно только ученику')
    item = await participation_access(db, participation_id, user)
    if item.status in ('completed', 'cancelled'):
        raise HTTPException(409, 'Участие уже закрыто')
    if body.decision == 'selected' and item.decision != 'selected':
        intake = await db.get(ActivityIntake, item.intake_id)
        activity = await db.get(Activity, intake.activity_id)
        if activity.publication == 'archived' or (intake.deadline and intake.deadline < date.today()):
            raise HTTPException(409, 'Набор закрыт')
    return await edit_participation(db, item, body.model_dump(exclude_unset=True), user)


@router.get('/participations/{participation_id}/tasks', response_model=list[RoadmapTaskOut])
async def participation_tasks(participation_id: uuid.UUID, db: DB, user: CurrentUser):
    await participation_access(db, participation_id, user)
    if user.role != UserRole.student:
        require_access(user, 'roadmaps', Action.view)
    rows = (await db.execute(select(RoadmapTask, Stage.visible_to_student, Roadmap.status)
        .join(Stage, RoadmapTask.stage_id == Stage.id).join(Roadmap, RoadmapTask.roadmap_id == Roadmap.id)
        .where(RoadmapTask.activity_participation_id == participation_id, RoadmapTask.deleted_at.is_(None))
        .options(selectinload(RoadmapTask.subtasks)).order_by(RoadmapTask.due_date.asc().nullslast(), RoadmapTask.position))).all()
    return [task for task, visible, roadmap_status in rows if user.role != UserRole.student or
        (roadmap_status == RoadmapStatus.active and task_visible_to_student(audience=task.audience, task_visible=task.visible_to_student, stage_visible=visible))]


@router.post('/participations/{participation_id}/tasks', response_model=dict)
async def link_task(participation_id: uuid.UUID, body: ActivityTaskLink, db: DB, user: CurrentUser):
    require_access(user, 'roadmaps', Action.edit)
    item = await participation_access(db, participation_id, user)
    await validate_activity_task(db, participation_id, item.student_id)
    task = await db.get(RoadmapTask, body.task_id)
    roadmap = await db.get(Roadmap, task.roadmap_id) if task else None
    if not roadmap or roadmap.student_id != item.student_id:
        raise HTTPException(404, 'Задача не найдена для этого ученика')
    if task.activity_participation_id and task.activity_participation_id != item.id:
        raise HTTPException(409, 'Задача уже относится к другой активности')
    if task.activity_participation_id != item.id:
        task.activity_participation_id = item.id
        await log_change(db, 'roadmap_task', task.id, 'activity_participation_id', None, item.id, str(user.id), source='portfolio')
    await db.commit()
    return {'task_id': task.id, 'participation_id': item.id}


@router.get('/staff/participations')
async def staff_participations(db: DB, user: CurrentUser, student_id: uuid.UUID | None = None,
    activity_id: uuid.UUID | None = None, q: str = Query('', max_length=200),
    decision: str | None = Query(None, pattern='^(selected|suggested|not_interested)$'),
    status: str | None = Query(None, pattern='^(not_started|in_progress|submitted|completed|cancelled)$'),
    source: str | None = Query(None, pattern='^(unknown|student|staff)$'),
    column: str | None = Query(None, pattern='^(suggested|planning|in_work|review|done|closed)$'),
    view: str = Query('all', pattern='^(all|waiting|due_soon|closed)$'),
    offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=500)):
    """Участия для доски и таблицы. Колонка вычисляется (activity_board), поэтому
    фильтр по ней и счётчики считаются после выборки — в пределах учеников
    сотрудника это сотни строк, не больше."""
    require_access(user, 'portfolio', Action.manage)
    if student_id:
        await require_activity_student(db, student_id, user)
    query = participation_rows()
    allowed = await activity_student_ids(db, user)
    if allowed is not None:
        query = query.where(StudentActivity.student_id.in_(allowed))
    if student_id: query = query.where(StudentActivity.student_id == student_id)
    if activity_id: query = query.where(Activity.id == activity_id)
    if decision: query = query.where(StudentActivity.decision == decision)
    if status: query = query.where(StudentActivity.status == status)
    if source: query = query.where(StudentActivity.selection_source == source)
    if q.strip():
        query = query.where(or_(Student.full_name.ilike('%' + q.strip() + '%'), Activity.title.ilike('%' + q.strip() + '%')))
    rows = (await db.execute(query.order_by(StudentActivity.created_at.desc(), StudentActivity.id))).all()
    steps = await steps_by_participation(db, [row[0].id for row in rows], for_student=False)
    today = date.today()
    items = []
    for item, intake, activity, mentor, name, selected_by in rows:
        summary = steps.get(item.id, StepsSummary())
        col = board_column(item.decision, item.status, summary)
        due = nearest_due(item.personal_deadline, intake.deadline, summary)
        items.append(BoardItem(**ParticipationOut.model_validate(item).model_dump(),
            activity=ActivityOut.model_validate(activity), intake=IntakeOut.model_validate(intake),
            student_name=name, mentor_name=mentor, selected_by_name=selected_by, steps=summary,
            column=col, due=due, due_soon=is_due_soon(col, due, today),
            needs_reminder=needs_reminder(col, summary, item.created_at.date(), today)))
    open_items = [i for i in items if i.column != 'closed']
    counts = {
        'all': len(open_items),
        'waiting': sum(i.column in MENTOR_ACTION_COLUMNS for i in open_items),
        'due_soon': sum(i.due_soon for i in open_items),
        'closed': len(items) - len(open_items),
    }
    by_view = {
        'all': open_items,
        'waiting': [i for i in open_items if i.column in MENTOR_ACTION_COLUMNS],
        'due_soon': [i for i in open_items if i.due_soon],
        'closed': [i for i in items if i.column == 'closed'],
    }[view]
    columns = {c: sum(i.column == c for i in by_view) for c in ('suggested', 'planning', 'in_work', 'review', 'done', 'closed')}
    if column:
        by_view = [i for i in by_view if i.column == column]
    return {'items': by_view[offset:offset + limit], 'total': len(by_view), 'offset': offset, 'limit': limit,
            'counts': counts, 'columns': columns}


@router.get('/staff/students')
async def staff_students(db: DB, user: CurrentUser):
    """Кому сотрудник может рекомендовать активность — в пределах его учеников."""
    require_access(user, 'portfolio', Action.manage)
    query = select(Student.id, Student.full_name).where(Student.is_archived.is_(False)).order_by(Student.full_name)
    allowed = await activity_student_ids(db, user)
    if allowed is not None:
        query = query.where(Student.id.in_(allowed))
    return [{'id': sid, 'name': name} for sid, name in (await db.execute(query)).all()]


@router.get('/catalog/rows')
async def catalog_rows(db: DB, user: CurrentUser):
    require_access(user, 'portfolio', Action.manage)
    rows = (await db.execute(select(Activity, ActivityIntake).outerjoin(ActivityIntake, ActivityIntake.activity_id == Activity.id)
        .order_by(Activity.title, ActivityIntake.label))).all()
    return [{'activity': ActivityOut.model_validate(activity), 'intake': IntakeOut.model_validate(intake) if intake else None}
        for activity, intake in rows]
