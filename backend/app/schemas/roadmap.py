from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, model_validator

from app.models.roadmap import TaskPriority, TaskAudience, RoadmapItemStatus, RoadmapStatus
from app.services.task_urgency import task_urgency

_cfg = ConfigDict(from_attributes=True, use_enum_values=True)


# ---------- Template: input (nested structure) ----------
class SubtaskIn(BaseModel):
    title: str
    source_notion_page_id: str | None = None


class TaskIn(BaseModel):
    title: str
    description: str = ""
    expected_result: str = ""
    needs_document: bool = False
    needs_zoom: bool = False
    questionnaire_url: str | None = None
    source_notion_page_id: str | None = None
    priority: TaskPriority = TaskPriority.required
    audience: TaskAudience = TaskAudience.applicant
    due_offset_days: int | None = None
    subtasks: list[SubtaskIn] = []


class StageIn(BaseModel):
    name: str
    description: str = ""
    tasks: list[TaskIn] = []


class TemplateCreate(BaseModel):
    name: str
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


class AssignRequest(BaseModel):
    student_id: uuid.UUID
    mentor_id: uuid.UUID | None = None
    name: str | None = None  # override roadmap name


# ---------- Template: output ----------
class TemplateSubtaskOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    title: str
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
    stages: list[TemplateStageOut] = []


class TemplateListItem(BaseModel):
    model_config = _cfg
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
    position: int


class RoadmapTaskOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    stage_id: uuid.UUID
    roadmap_id: uuid.UUID
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
    def _fill_urgency(self) -> "RoadmapTaskOut":
        self.urgency = task_urgency(self.due_date, self.status)
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
    id: uuid.UUID
    stage_id: uuid.UUID
    roadmap_id: uuid.UUID
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


class SubtaskCreate(BaseModel):
    task_id: uuid.UUID
    title: str


class SubtaskUpdate(BaseModel):
    title: str | None = None
    is_done: bool | None = None


class StageUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    visible_to_student: bool | None = None
    status: RoadmapItemStatus | None = None
