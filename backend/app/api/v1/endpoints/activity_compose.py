"""Конструктор активности: создание одним запросом, типовые шаги, дубли, копии."""
import re
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.activity_board import intake_label
from app.api.v1.endpoints.activities import assert_publishable, activity_values, require_catalog_editor, visible_activity
from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.activity import Activity, ActivityIntake, ActivityStepTemplate
from app.schemas.activity import ActivityComposeInput, ActivityOut, DuplicateMatch, IntakeOut, StepTemplateInput, TemplateStep

router = APIRouter(prefix='/activities', tags=['activities'])
DB = Annotated[AsyncSession, Depends(get_db)]


def template_rows(activity_id: uuid.UUID, steps: list[TemplateStep]) -> list[ActivityStepTemplate]:
    return [ActivityStepTemplate(activity_id=activity_id, position=i, **step.model_dump()) for i, step in enumerate(steps)]


async def load_template(db, activity_id) -> list[TemplateStep]:
    rows = (await db.execute(select(ActivityStepTemplate).where(ActivityStepTemplate.activity_id == activity_id)
        .order_by(ActivityStepTemplate.position, ActivityStepTemplate.id))).scalars().all()
    return [TemplateStep.model_validate(row) for row in rows]


@router.post('/full', response_model=ActivityOut, status_code=201)
async def create_full(body: ActivityComposeInput, db: DB, user: CurrentUser):
    """Карточка, первый набор и типовые шаги — одной транзакцией, без «пустых» черновиков."""
    require_catalog_editor(user)
    activity = Activity(**activity_values(body.activity))
    db.add(activity)
    await db.flush()
    if body.intake:
        values = body.intake.model_dump()
        values['label'] = intake_label(values.get('label'), values.get('deadline'), values.get('mode', 'unknown'))
        db.add(ActivityIntake(activity_id=activity.id, **values))
    db.add_all(template_rows(activity.id, body.steps))
    await db.flush()
    await assert_publishable(db, activity, was_published=False)
    await log_change(db, 'activity', activity.id, 'created', None, activity.title, str(user.id), source='portfolio')
    await db.commit()
    await db.refresh(activity)
    return activity


@router.get('/{activity_id}/step-template', response_model=list[TemplateStep])
async def get_template(activity_id: uuid.UUID, db: DB, user: CurrentUser):
    await visible_activity(db, activity_id, user)
    return await load_template(db, activity_id)


@router.put('/{activity_id}/step-template', response_model=list[TemplateStep])
async def put_template(activity_id: uuid.UUID, body: StepTemplateInput, db: DB, user: CurrentUser):
    """Шаблон заменяется целиком: это заготовка, а не история. Выданные ученикам
    планы — их копии — не меняются."""
    require_catalog_editor(user)
    await visible_activity(db, activity_id, user)
    await db.execute(delete(ActivityStepTemplate).where(ActivityStepTemplate.activity_id == activity_id))
    db.add_all(template_rows(activity_id, body.steps))
    await log_change(db, 'activity', activity_id, 'step_template', None, str(len(body.steps)), str(user.id), source='portfolio')
    await db.commit()
    return await load_template(db, activity_id)


def _norm_url(url: str | None) -> str:
    return re.sub(r'^https?://(www\.)?', '', (url or '').strip().lower()).rstrip('/')


@router.get('/staff/duplicates', response_model=list[DuplicateMatch])
async def duplicates(db: DB, user: CurrentUser, title: str = Query('', max_length=500), source_url: str = Query('', max_length=2048),
                     exclude: uuid.UUID | None = None):
    """Похожие записи каталога: то же название (без учёта регистра) или тот же сайт."""
    require_catalog_editor(user)
    title, url = title.strip(), _norm_url(source_url)
    if len(title) < 4 and not url:
        return []
    conditions = []
    if len(title) >= 4:
        conditions.append(func.lower(func.trim(Activity.title)) == title.lower())
    if url:
        conditions.append(func.lower(Activity.source_url).contains(url))
    query = select(Activity).where(or_(*conditions))
    if exclude:
        query = query.where(Activity.id != exclude)
    rows = (await db.execute(query.limit(5))).scalars().all()
    return [DuplicateMatch(id=a.id, title=a.title, publication=a.publication,
        reason='title' if a.title.strip().lower() == title.lower() else 'source_url') for a in rows
        if a.title.strip().lower() == title.lower() or (url and _norm_url(a.source_url) == url)]


@router.post('/{activity_id}/duplicate', response_model=ActivityOut, status_code=201)
async def duplicate(activity_id: uuid.UUID, db: DB, user: CurrentUser):
    """Копия для похожей возможности: карточка и типовые шаги. Наборы не копируем —
    у новой активности свои сроки, старые даты выдали бы неправду."""
    require_catalog_editor(user)
    source = await visible_activity(db, activity_id, user)
    copy = Activity(**{c: getattr(source, c) for c in ('direction', 'kind', 'organizer', 'country', 'description',
        'eligibility', 'assignment', 'source_url', 'experience_type', 'result_requires_file')}, title=f'{source.title} (копия)'[:500], publication='draft')
    db.add(copy)
    await db.flush()
    db.add_all(template_rows(copy.id, await load_template(db, activity_id)))
    await log_change(db, 'activity', copy.id, 'duplicated', str(activity_id), copy.title, str(user.id), source='portfolio')
    await db.commit()
    await db.refresh(copy)
    return copy


def _next_year(value: date) -> date:
    try:
        return value.replace(year=value.year + 1)
    except ValueError:  # 29 февраля
        return value.replace(year=value.year + 1, day=28)


@router.post('/{activity_id}/intakes/{intake_id}/next-season', response_model=IntakeOut, status_code=201)
async def next_season(activity_id: uuid.UUID, intake_id: uuid.UUID, db: DB, user: CurrentUser):
    """Тот же набор через год: годы в названии и дедлайн сдвигаются на +1."""
    require_catalog_editor(user)
    await visible_activity(db, activity_id, user)
    intake = await db.get(ActivityIntake, intake_id)
    if not intake or intake.activity_id != activity_id:
        raise HTTPException(404, 'Набор не найден')
    label = re.sub(r'(?<!\d)(20\d\d)(?!\d)', lambda m: str(int(m.group(1)) + 1), intake.label)
    if label == intake.label:
        label = f'{intake.label} · следующий сезон'[:255]
    copy = ActivityIntake(activity_id=activity_id, label=label, mode=intake.mode, format=intake.format,
        deadline=_next_year(intake.deadline) if intake.deadline else None,
        # Даты и цена следующего сезона ещё не подтверждены организатором.
        dates_text=None, cost_state='unknown' if intake.cost_state == 'paid' else intake.cost_state, cost_text=None)
    db.add(copy)
    await db.commit()
    await db.refresh(copy)
    return copy
