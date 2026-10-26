from __future__ import annotations

import uuid
from typing import Annotated
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.models.roadmap import TaskPriority, TaskAudience, RoadmapItemStatus, RoadmapStatus
from app.services.task_urgency import NO_URGENCY_STATUSES, overdue_days, task_urgency

_cfg = ConfigDict(from_attributes=True, use_enum_values=True)


# ---------- Template: input (nested structure) ----------
TemplateTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
StageName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class SubtaskIn(BaseModel):
    title: TemplateTitle
    due_offset_days: int | None = Field(default=None, ge=0)
    source_notion_page_id: str | None = None


class TaskIn(BaseModel):
    title: TemplateTitle
    description: str = ""
    expected_result: str = ""
    needs_document: bool = False
    needs_zoom: bool = False
    questionnaire_url: str | None = None
    source_notion_page_id: str | None = None
    priority: TaskPriority = TaskPriority.required
    audience: TaskAudience = TaskAudience.applicant
    due_offset_days: int | None = Field(default=None, ge=0)
    subtasks: list[SubtaskIn] = []


class StageIn(BaseModel):
    name: StageName
    description: str = ""
    tasks: list[TaskIn] = []


class TemplateCreate(BaseModel):
    name: StageName
    country_name: str | None = None
    degree: str = "bachelors"
    year: int
    description: str = ""
    source_notion_db_id: str | None = None
    source_notion_title: str | None = None
    source_notion_last_edited_at: datetime | None = None
    stages: list[StageIn] = []


class TemplateMetaUpdate(BaseModel):
    name: str | None = None
    country_name: str | None = None
    degree: str | None = None
    year: int | None = None
    description: str | None = None


class StructureIn(BaseModel):
    stages: list[StageIn]


class TemplateSave(BaseModel):
    name: StageName
    country_name: str | None = Field(default=None, max_length=200)
    degree: str = Field(default="bachelors", min_length=1, max_length=40)
    year: int = Field(ge=2000, le=2200)
    description: str = ""
    stages: list[StageIn]
    revision: int = Field(ge=1)

    @model_validator(mode="after")
    def unique_sources(self):
        for items in (
            [task for stage in self.stages for task in stage.tasks],
            [sub for stage in self.stages for task in stage.tasks for sub in task.subtasks],
        ):
            ids = [item.source_notion_page_id for item in items if item.source_notion_page_id]
            if len(ids) != len(set(ids)):
                raise ValueError("Повторяющиеся ссылки на задачи Notion")
        return self


class AssignRequest(BaseModel):
    student_id: uuid.UUID
    mentor_id: uuid.UUID | None = None
    name: str | None = None  # override roadmap name


# ---------- Template: output ----------
class TemplateSubtaskOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    title: str
    due_offset_days: int | None = None
    position: int
    source_notion_page_id: str | None = None


class TemplateTaskOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    title: str
    description: str
    expected_result: str = ""
    needs_document: bool = False
    needs_zoom: bool = False
    questionnaire_url: str | None = None
    source_notion_page_id: str | None = None
    priority: str
    audience: str
    due_offset_days: int | None = None
    position: int
    subtasks: list[TemplateSubtaskOut] = []


class TemplateStageOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    name: str
    description: str
    position: int
    tasks: list[TemplateTaskOut] = []


class TemplateOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    name: str
    country_name: str | None = None
    degree: str
    year: int
    description: str
    source_notion_db_id: str | None = None
    source_notion_title: str | None = None
    source_notion_last_edited_at: datetime | None = None
    created_at: datetime
    locally_edited: bool = False
    revision: int = 1
    stages: list[TemplateStageOut] = []


class TemplateListItem(BaseModel):
    model_config = _cfg
    locally_edited: bool = False
    id: uuid.UUID
    name: str
    country_name: str | None = None
    degree: str
    year: int
    stage_count: int = 0
    task_count: int = 0
    source_notion_db_id: str | None = None
    source_notion_title: str | None = None
    source_notion_last_edited_at: datetime | None = None


# ---------- Live roadmap ----------
class RoadmapSubtaskOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    title: str
    is_done: bool
    due_date: date | None = None
    overdue_days: int = 0  # computed, not a DB column
    position: int

    @model_validator(mode="after")
    def _fill_overdue(self) -> "RoadmapSubtaskOut":
        self.overdue_days = overdue_days(self.due_date, done=self.is_done)
        return self


class RoadmapTaskOut(BaseModel):
    model_config = _cfg
    activity_participation_id: uuid.UUID | None = None
    id: uuid.UUID
    student_id: uuid.UUID | None = None
    requires_review: bool = True
    requires_evidence: bool = False
    result_text: str | None = None
    stage_id: uuid.UUID | None = None
    roadmap_id: uuid.UUID | None = None
    title: str
    description: str
    expected_result: str = ""
    needs_document: bool = False
    needs_zoom: bool = False
    questionnaire_url: str | None = None
    priority: str
    audience: str
    visible_to_student: bool = True
    status: str
    review_status: str = "none"
    completed_at: datetime | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    due_date: date | None = None
    urgency: str | None = None  # resolved via app.services.task_urgency, not a DB column
    overdue_days: int = 0  # computed, not a DB column
    position: int
    subtasks: list[RoadmapSubtaskOut] = []

    @field_validator("subtasks", mode="before")
    @classmethod
    def _active_subtasks(cls, value):
        return [item for item in value if getattr(item, "deleted_at", None) is None]

    @model_validator(mode="after")
    def _fill_urgency(self) -> "RoadmapTaskOut":
        self.urgency = task_urgency(self.due_date, self.status)
        self.overdue_days = overdue_days(self.due_date, done=self.status in NO_URGENCY_STATUSES)
        self.subtasks = sorted(self.subtasks, key=lambda subtask: subtask.position)
        return self


class StageOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    roadmap_id: uuid.UUID
    name: str
    description: str
    position: int
    status: str
    visible_to_student: bool = True
    tasks_total: int = 0
    required_total: int = 0
    required_done: int = 0
    can_complete: bool = True
    tasks: list[RoadmapTaskOut] = []

    @field_validator("tasks", mode="before")
    @classmethod
    def _active_tasks(cls, value):
        return [item for item in value if getattr(item, "deleted_at", None) is None]


class RoadmapOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    student_id: uuid.UUID
    mentor_id: uuid.UUID | None = None
    mentor_name: str | None = None
    template_id: uuid.UUID | None = None
    name: str
    country_name: str | None = None
    country_flag_emoji: str = ""
    country_flag_url: str = ""
    degree: str
    year: int
    status: str
    created_at: datetime
    stages: list[StageOut] = []


class TaskFlatOut(BaseModel):
    """A roadmap task with its stage context — for the flat 'Задачи' board."""
    model_config = _cfg
    activity_participation_id: uuid.UUID | None = None
    id: uuid.UUID
    student_id: uuid.UUID | None = None
    requires_review: bool = True
    requires_evidence: bool = False
    result_text: str | None = None
    stage_id: uuid.UUID | None = None
    roadmap_id: uuid.UUID | None = None
    stage_name: str
    stage_position: int
    title: str
    description: str
    expected_result: str = ""
    needs_document: bool = False
    needs_zoom: bool = False
    questionnaire_url: str | None = None
    priority: str
    audience: str
    visible_to_student: bool = True
    status: str
    review_status: str = "none"
    completed_at: datetime | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    due_date: date | None = None
    urgency: str | None = None  # resolved via app.services.task_urgency, not a DB column
    position: int
    subtasks: list[RoadmapSubtaskOut] = []

    @model_validator(mode="after")
    def _fill_urgency(self) -> "TaskFlatOut":
        self.urgency = task_urgency(self.due_date, self.status)
        return self


# ---------- Student claim / mentor review ----------
class TaskReviewIn(BaseModel):
    action: str  # approve | return
    comment: str | None = None


class ClaimProgressOut(BaseModel):
    """Прогресс roadmap после заявки — чтобы портал отреагировал в кадре клика."""
    done: int
    pending: int
    total: int


class TaskClaimOut(BaseModel):
    task: TaskFlatOut
    progress: ClaimProgressOut
    stage_claimed: bool  # все задачи этапа done или pending — повод для нажима/анимации


# ---------- Task / subtask / stage mutations ----------
class TaskCreate(BaseModel):
    activity_participation_id: uuid.UUID | None = None
    stage_id: uuid.UUID
    title: str
    description: str = ""
    expected_result: str = ""
    needs_document: bool = False
    needs_zoom: bool = False
    questionnaire_url: str | None = None
    priority: TaskPriority = TaskPriority.required
    audience: TaskAudience = TaskAudience.applicant
    visible_to_student: bool = True
    due_date: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    expected_result: str | None = None
    needs_document: bool | None = None
    needs_zoom: bool | None = None
    questionnaire_url: str | None = None
    priority: TaskPriority | None = None
    audience: TaskAudience | None = None
    visible_to_student: bool | None = None
    status: RoadmapItemStatus | None = None
    due_date: date | None = None


_MIN_DEADLINE = date(2000, 1, 1)
_MAX_DEADLINE = date(2100, 12, 31)


def _check_deadline(value: date | None) -> date | None:
    if value is not None and not _MIN_DEADLINE <= value <= _MAX_DEADLINE:
        raise ValueError("Срок вне допустимого диапазона (2000–2100)")
    return value


class SubtaskCreate(BaseModel):
    title: str
    due_date: date | None = None

    _v_due = field_validator("due_date")(_check_deadline)


class SubtaskUpdate(BaseModel):
    title: str | None = None
    is_done: bool | None = None
    due_date: date | None = None
    position: int | None = Field(default=None, ge=0)

    _v_due = field_validator("due_date")(_check_deadline)


class StageUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    visible_to_student: bool | None = None
    status: RoadmapItemStatus | None = None
