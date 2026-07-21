"""Roadmap feature: reusable templates + live per-student roadmaps.

Templates (roadmap_templates → template_stages → template_tasks → template_subtasks)
are authored by staff per country/degree. Assigning a template materializes a live
roadmap for a student (roadmaps → stages → roadmap_tasks → roadmap_subtasks), keyed
on students.id so staff control it from the CRM card and the student sees it in the
portal.
"""
import uuid
from datetime import datetime, date, timezone
import enum

from sqlalchemy import String, Integer, Text, Date, DateTime, Boolean, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TaskPriority(str, enum.Enum):
    required = "required"
    recommended = "recommended"
    optional = "optional"


class TaskAudience(str, enum.Enum):
    applicant = "applicant"       # visible/actionable by the student
    coordinator = "coordinator"   # internal task for staff


class RoadmapItemStatus(str, enum.Enum):
    planned = "planned"
    in_progress = "in_progress"
    done = "done"


class RoadmapStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
class RoadmapTemplate(Base):
    __tablename__ = "roadmap_templates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(300))
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    country_ref_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("country_reference.id", ondelete="SET NULL"), nullable=True
    )
    degree: Mapped[str] = mapped_column(String(40), default="bachelors")
    year: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    source_notion_db_id: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    source_notion_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_notion_last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    stages: Mapped[list["TemplateStage"]] = relationship(
        back_populates="template", cascade="all, delete-orphan", order_by="TemplateStage.position"
    )


class TemplateStage(Base):
    __tablename__ = "template_stages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    template_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roadmap_templates.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=0)

    template: Mapped["RoadmapTemplate"] = relationship(back_populates="stages")
    tasks: Mapped[list["TemplateTask"]] = relationship(
        back_populates="stage", cascade="all, delete-orphan", order_by="TemplateTask.position"
    )


class TemplateTask(Base):
    __tablename__ = "template_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("template_stages.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    expected_result: Mapped[str] = mapped_column(Text, default="", server_default="")
    needs_document: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    needs_zoom: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    questionnaire_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    source_notion_page_id: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    priority: Mapped[TaskPriority] = mapped_column(
        SAEnum(TaskPriority, name="task_priority"), default=TaskPriority.required
    )
    audience: Mapped[TaskAudience] = mapped_column(
        SAEnum(TaskAudience, name="task_audience"), default=TaskAudience.applicant
    )
    due_offset_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)

    stage: Mapped["TemplateStage"] = relationship(back_populates="tasks")
    subtasks: Mapped[list["TemplateSubtask"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TemplateSubtask.position"
    )


class TemplateSubtask(Base):
    __tablename__ = "template_subtasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("template_tasks.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(Integer, default=0)
    source_notion_page_id: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)

    task: Mapped["TemplateTask"] = relationship(back_populates="subtasks")


# ---------------------------------------------------------------------------
# Live roadmaps (per student)
# ---------------------------------------------------------------------------
class Roadmap(Base):
    __tablename__ = "roadmaps"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roadmap_templates.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(300))
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    degree: Mapped[str] = mapped_column(String(40), default="bachelors")
    year: Mapped[int] = mapped_column(Integer)
    status: Mapped[RoadmapStatus] = mapped_column(
        SAEnum(RoadmapStatus, name="roadmap_status"), default=RoadmapStatus.active
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    stages: Mapped[list["Stage"]] = relationship(
        back_populates="roadmap", cascade="all, delete-orphan", order_by="Stage.position"
    )


class Stage(Base):
    __tablename__ = "stages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    roadmap_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roadmaps.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[RoadmapItemStatus] = mapped_column(
        SAEnum(RoadmapItemStatus, name="roadmap_item_status"), default=RoadmapItemStatus.planned
    )

    roadmap: Mapped["Roadmap"] = relationship(back_populates="stages")
    tasks: Mapped[list["RoadmapTask"]] = relationship(
        back_populates="stage", cascade="all, delete-orphan", order_by="RoadmapTask.position"
    )


class RoadmapTask(Base):
    __tablename__ = "roadmap_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stages.id", ondelete="CASCADE"), index=True)
    roadmap_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roadmaps.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    expected_result: Mapped[str] = mapped_column(Text, default="", server_default="")
    needs_document: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    needs_zoom: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    questionnaire_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    priority: Mapped[TaskPriority] = mapped_column(
        SAEnum(TaskPriority, name="task_priority"), default=TaskPriority.required
    )
    audience: Mapped[TaskAudience] = mapped_column(
        SAEnum(TaskAudience, name="task_audience"), default=TaskAudience.applicant
    )
    status: Mapped[RoadmapItemStatus] = mapped_column(
        SAEnum(RoadmapItemStatus, name="roadmap_item_status"), default=RoadmapItemStatus.planned
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    stage: Mapped["Stage"] = relationship(back_populates="tasks")
    subtasks: Mapped[list["RoadmapSubtask"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="RoadmapSubtask.position"
    )


class RoadmapSubtask(Base):
    __tablename__ = "roadmap_subtasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roadmap_tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    position: Mapped[int] = mapped_column(Integer, default=0)

    task: Mapped["RoadmapTask"] = relationship(back_populates="subtasks")
