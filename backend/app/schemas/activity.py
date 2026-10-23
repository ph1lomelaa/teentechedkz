import uuid
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator
from app.services.experience import experience_type

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
    # Явный выбор типа опыта; None — вывести из kind.
    experience_type: Literal['competitions', 'research', 'programs', 'courses', 'internships', 'social', 'other'] | None = None
    # Итог подтверждается только с файлом.
    result_requires_file: bool = False
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
    # Явно выбранный тип или выведенный из kind (app/services/experience.py).
    experience_type: str | None = None
    # Тип выбран явно, а не угадан по kind — форма показывает выбор как сделанный.
    experience_explicit: bool = False

    @model_validator(mode='before')
    @classmethod
    def _mark_explicit(cls, data):
        # ORM-объект: явный выбор — непустая колонка. Словарь (пересборка из
        # дампа, например в ActivityCard) уже несёт признак — не перезаписываем.
        if isinstance(data, dict):
            return {**data, 'experience_explicit': data.get('experience_explicit', data.get('experience_type') is not None)}
        return {**{k: getattr(data, k) for k in cls.model_fields if hasattr(data, k)}, 'experience_explicit': getattr(data, 'experience_type', None) is not None}

    @model_validator(mode='after')
    def _fill_experience(self):
        self.experience_type = self.experience_type or experience_type(self.kind)
        return self

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
    # До какой даты решить по рекомендации (колонка или за 10 дней до подачи).
    decide_by: date | None = None
    created_at: datetime
    result_documents_count: int = 0
    certificates_count: int = 0
    result_text: str | None = None
    result_review_status: str = 'none'
    result_review_comment: str | None = None
    result_submitted_at: datetime | None = None
    result_reviewed_at: datetime | None = None
    decline_reason: str | None = None


class NextStep(BaseModel):
    id: uuid.UUID
    title: str
    due_date: date | None = None
    # returned — ментор вернул на правки; overdue — срок прошёл; todo — предстоит;
    # pending — отправлено, ждёт ментора.
    state: Literal['returned', 'overdue', 'todo', 'pending']
    # Когда ученик отправил работу — для «отправлено · вчера» на доске.
    submitted_at: datetime | None = None
    # Номер среди шагов участия (с 1) и проверяет ли ментор.
    index: int = 0
    requires_review: bool = False
    # Последний комментарий ментора — первым пунктом в «Сейчас» у шага на правках.
    review_comment: str | None = None
    reviewed_at: datetime | None = None


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
    decline_reason: str | None = Field(default=None, max_length=2000)

class ActivityTaskLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    task_id: uuid.UUID


# ---------------------------------------------------------------- сводка портфолио

ExperienceKey = Literal['competitions', 'research', 'programs', 'courses', 'internships', 'social', 'other']
ActionKind = Literal['fix_step', 'fix_result', 'do_step', 'submit_result', 'decide', 'step_waiting', 'result_waiting', 'plan_waiting']


class ExperienceTile(BaseModel):
    key: ExperienceKey
    label: str
    confirmed: int = 0
    active: int = 0


class PortfolioAction(BaseModel):
    """Одно действие в списке «Сейчас». owner — чей ход: ученика или ментора."""
    kind: ActionKind
    owner: Literal['student', 'mentor']
    participation_id: uuid.UUID
    activity_title: str
    student_id: uuid.UUID
    student_name: str | None = None
    step_id: uuid.UUID | None = None
    step_title: str | None = None
    due_date: date | None = None
    overdue: bool = False
    overdue_days: int = 0
    experience_type: str | None = None
    # Комментарий ментора к правкам и кто его оставил.
    comment: str | None = None
    comment_by: str | None = None
    comment_at: datetime | None = None
    # Рекомендация: причина, решить до, подача у организатора.
    reason: str | None = None
    decide_by: date | None = None
    submit_deadline: date | None = None


class PortfolioCounts(BaseModel):
    active: int = 0
    suggested: int = 0
    confirmed: int = 0
    waiting_mentor: int = 0
    waiting_student: int = 0
    overdue: int = 0


class PortfolioFocusOut(BaseModel):
    text: str
    types: list[ExperienceKey] = Field(default_factory=list)
    updated_at: datetime
    updated_by_name: str | None = None


class ShelfEntry(BaseModel):
    participation_id: uuid.UUID
    title: str


class ShelfCell(BaseModel):
    """Ячейка полки: заполнена достижением, в работе или пуста."""
    key: ExperienceKey
    label: str
    state: Literal['filled', 'in_work', 'empty']
    achievements: list[ShelfEntry] = Field(default_factory=list)
    in_work: list[ShelfEntry] = Field(default_factory=list)
    recommended: list[ShelfEntry] = Field(default_factory=list)


class NextDeadline(BaseModel):
    participation_id: uuid.UUID
    title: str
    date: date


class PortfolioSummary(BaseModel):
    focus: PortfolioFocusOut | None = None
    counts: PortfolioCounts
    experience: list[ExperienceTile]
    # Шесть ячеек полки (без «Другое»).
    shelf: list[ShelfCell] = Field(default_factory=list)
    next_deadline: NextDeadline | None = None
    # Ход ученика: одно самое срочное действие на участие.
    actions: list[PortfolioAction]
    # Всё, что ждёт ментора: план, шаги на проверке, итоги — независимо от хода ученика.
    mentor_actions: list[PortfolioAction] = Field(default_factory=list)


class StudentOverviewRow(BaseModel):
    student_id: uuid.UUID
    name: str
    focus_set: bool
    focus_text: str | None = None
    focus_types: list[ExperienceKey] = Field(default_factory=list)
    counts: PortfolioCounts
    experience_confirmed: list[ExperienceKey]
    next_deadline: NextDeadline | None = None


class FocusInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(default='', max_length=1000)
    types: list[Literal['competitions', 'research', 'programs', 'courses', 'internships', 'social']] = Field(default_factory=list, max_length=6)


# ---------------------------------------------------------------- конструктор активности

class TemplateStep(BaseModel):
    model_config = ConfigDict(extra='forbid', from_attributes=True)
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default='', max_length=20000)
    expected_result: str = Field(default='', max_length=10000)
    priority: Literal['required', 'recommended', 'optional'] = 'required'
    requires_review: bool = False
    requires_evidence: bool = False
    days_before_deadline: int | None = Field(default=None, ge=0, le=730)
    subtasks: list[str] = Field(default_factory=list, max_length=100)

    @field_validator('title')
    @classmethod
    def clean_title(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Название шага не может быть пустым')
        return value

    @field_validator('subtasks')
    @classmethod
    def clean_subtasks(cls, value):
        value = [s.strip() for s in value if s.strip()]
        if any(len(s) > 500 for s in value):
            raise ValueError('Пункт чеклиста слишком длинный')
        return value


class StepTemplateInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    steps: list[TemplateStep] = Field(default_factory=list, max_length=50)


class ActivityComposeInput(BaseModel):
    """Новая активность одним запросом: карточка, первый набор и типовые шаги."""
    model_config = ConfigDict(extra='forbid')
    activity: ActivityCreate
    intake: IntakeCreate | None = None
    steps: list[TemplateStep] = Field(default_factory=list, max_length=50)


class DuplicateMatch(BaseModel):
    id: uuid.UUID
    title: str
    publication: Publication
    reason: Literal['title', 'source_url']


# ---------------------------------------------------------------- история отправок шага

class SubmissionFile(BaseModel):
    id: uuid.UUID
    name: str


class SubmissionOut(BaseModel):
    id: uuid.UUID
    submitted_at: datetime
    note: str | None = None
    files: list[SubmissionFile] = Field(default_factory=list)
    verdict: Literal['pending', 'accepted', 'returned']
    review_comment: str | None = None
    reviewer_name: str | None = None
    reviewed_at: datetime | None = None
