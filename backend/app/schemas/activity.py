import uuid
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

Publication = Literal['draft', 'published', 'archived']
Decision = Literal['suggested', 'selected', 'not_interested']
ParticipationStatus = Literal['not_started', 'in_progress', 'submitted', 'completed', 'cancelled']

class ActivityCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=500)
    direction: str | None = Field(default=None, max_length=255)
    kind: str | None = Field(default=None, max_length=100)
    organizer: str | None = Field(default=None, max_length=500)
    country: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=20000)
    eligibility: str | None = Field(default=None, max_length=20000)
    assignment: str | None = Field(default=None, max_length=20000)
    source_url: HttpUrl | None = Field(default=None, max_length=2048)
    publication: Publication = 'draft'
    conditions_checked_at: date | None = None
    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Название не может быть пустым')
        return value

class ActivityOut(ActivityCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime

class IntakeCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    label: str = Field(min_length=1, max_length=255)
    mode: Literal['fixed', 'rolling', 'self_paced', 'unknown'] = 'unknown'
    deadline: date | None = None
    dates_text: str | None = Field(default=None, max_length=20000)
    format: str | None = Field(default=None, max_length=100)
    cost_state: Literal['free', 'paid', 'unknown'] = 'unknown'
    cost_text: str | None = Field(default=None, max_length=500)

    @field_validator('label')
    @classmethod
    def clean_label(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Название набора не может быть пустым')
        return value

class IntakeOut(IntakeCreate):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    activity_id: uuid.UUID

class ParticipationCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    intake_id: uuid.UUID
    goal: str | None = Field(default=None, max_length=5000)

class StaffParticipationCreate(ParticipationCreate):
    decision: Literal['suggested', 'selected'] = 'suggested'
    recommendation_note: str | None = Field(default=None, max_length=2000)
    personal_deadline: date | None = None

class ParticipationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    student_id: uuid.UUID
    intake_id: uuid.UUID
    mentor_id: uuid.UUID | None
    selection_source: Literal['unknown', 'student', 'staff'] = 'unknown'
    selected_by_id: uuid.UUID | None = None
    decision: Decision
    status: ParticipationStatus
    goal: str | None
    recommendation_note: str | None = None
    personal_deadline: date | None = None
    created_at: datetime


class NextStep(BaseModel):
    id: uuid.UUID
    title: str
    due_date: date | None = None
    # returned — ментор вернул на правки; overdue — срок прошёл; todo — предстоит;
    # pending — отправлено, ждёт ментора.
    state: Literal['returned', 'overdue', 'todo', 'pending']
    # Когда ученик отправил работу — для «отправлено · вчера» на доске.
    submitted_at: datetime | None = None


class StepsSummary(BaseModel):
    segment_states: list[Literal['done', 'pending', 'todo']] = Field(default_factory=list)
    total: int = 0
    done: int = 0
    pending: int = 0
    returned: int = 0
    overdue: int = 0
    next: NextStep | None = None


class ParticipationDetail(ParticipationOut):
    student_name: str | None = None
    mentor_name: str | None = None
    selected_by_name: str | None = None
    activity: ActivityOut
    intake: IntakeOut
    steps: StepsSummary = Field(default_factory=StepsSummary)


BoardColumn = Literal['suggested', 'planning', 'in_work', 'review', 'done', 'closed']


class BoardItem(ParticipationDetail):
    """Участие на доске ментора: колонка и флаги вычислены на сервере."""
    column: BoardColumn
    due: date | None = None
    due_soon: bool = False
    needs_reminder: bool = False


class ActivityCard(ActivityOut):
    """Строка каталога: ближайший набор, чтобы карточка показала срок и стоимость."""
    next_intake: IntakeOut | None = None
    # Сколько наборов всего: next_intake=None при intake_count>0 значит «набор закрыт».
    intake_count: int = 0
    # Что команде проверить перед публикацией; ученику не отдаётся.
    review_issues: list[str] = Field(default_factory=list)


class ParticipationEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    goal: str | None = Field(default=None, max_length=5000)
    mentor_id: uuid.UUID | None = None
    decision: Decision = 'selected'
    status: ParticipationStatus = 'not_started'
    recommendation_note: str | None = Field(default=None, max_length=2000)
    personal_deadline: date | None = None

class MyParticipationEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    goal: str | None = Field(default=None, max_length=5000)
    decision: Literal['selected', 'not_interested'] = 'selected'

class ActivityTaskLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    task_id: uuid.UUID
