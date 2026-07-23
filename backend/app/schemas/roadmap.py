from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict

from app.models.roadmap import TaskPriority, TaskAudience, RoadmapItemStatus, RoadmapStatus

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
    status: str
    due_date: date | None = None
    position: int
    subtasks: list[RoadmapSubtaskOut] = []


class StageOut(BaseModel):
    model_config = _cfg
    id: uuid.UUID
    roadmap_id: uuid.UUID
    name: str
    description: str
    position: int
    status: str
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
    status: str
    due_date: date | None = None
    position: int
    subtasks: list[RoadmapSubtaskOut] = []


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
    status: RoadmapItemStatus | None = None
