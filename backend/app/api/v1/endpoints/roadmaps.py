"""Roadmap API — templates (staff-authored) and live per-student roadmaps.

Access model:
- Templates: admin / mzk_manager only.
- Assign / create / edit structure of a live roadmap: staff (admin, mzk_manager,
  mentor-in-scope).
- View roadmap + advance own progress (task/subtask/stage status): the owning
  student too.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.services import background_jobs
from app.services.country_flags import attach_flags
from app.services.mentor_scope import ensure_lead_assignment, primary_mentor_id, require_student_access
from app.services.questionnaire_seed import seed_questionnaire_for_task
from app.models.student import Student
from app.models.user import User, UserRole
from app.models.roadmap import (
    RoadmapTemplate, TemplateStage, TemplateTask, TemplateSubtask,
    Roadmap, Stage, RoadmapTask, RoadmapSubtask, RoadmapStatus,
)
from app.schemas.roadmap import (
    TemplateCreate, TemplateMetaUpdate, StructureIn, AssignRequest,
    TemplateOut, TemplateListItem, RoadmapOut, TaskFlatOut, RoadmapSubtaskOut,
    TaskCreate, TaskUpdate, SubtaskIn, SubtaskUpdate, StageUpdate,
)

router = APIRouter(tags=["roadmap"])

STAFF = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
TEMPLATE_ADMIN = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)

_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_NOT_FOUND = HTTPException(status_code=404, detail="Не найдено")


class NotionRoadmapImportRequest(BaseModel):
    dry_run: bool = False
    discover_only: bool = False
    skip_subtasks: bool = False
    only: str | None = None


_IMPORT_JOB_KIND = "roadmap_import"


# --------------------------------------------------------------------------
# Permission helpers
# --------------------------------------------------------------------------
async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


async def _assert_view(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    """Staff-in-scope or the owning student may view."""
    if user.role == UserRole.student:
        if await _my_student_id(db, user) != student_id:
            raise _NOT_FOUND
        return
    if user.role in STAFF:
        await require_student_access(db, student_id, user)
        return
    raise _FORBIDDEN


async def _assert_staff(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    """Only staff-in-scope may edit structure."""
    if user.role not in STAFF:
        raise _FORBIDDEN
    await require_student_access(db, student_id, user)


def _assert_template_admin(user) -> None:
    if user.role not in TEMPLATE_ADMIN:
        raise _FORBIDDEN


_ROADMAP_LOADER = (
    selectinload(Roadmap.stages)
    .selectinload(Stage.tasks)
    .selectinload(RoadmapTask.subtasks)
)
_TEMPLATE_LOADER = (
    selectinload(RoadmapTemplate.stages)
    .selectinload(TemplateStage.tasks)
    .selectinload(TemplateTask.subtasks)
)


async def _load_roadmap(db: AsyncSession, roadmap_id: uuid.UUID) -> Roadmap | None:
    res = await db.execute(
        select(Roadmap).where(Roadmap.id == roadmap_id).options(_ROADMAP_LOADER)
    )
    roadmap = res.scalar_one_or_none()
    await attach_flags(db, roadmap)
    await _attach_mentor_name(db, roadmap)
    return roadmap


async def _student_of_roadmap(db: AsyncSession, roadmap_id: uuid.UUID) -> uuid.UUID | None:
    res = await db.execute(select(Roadmap.student_id).where(Roadmap.id == roadmap_id))
    return res.scalar_one_or_none()


# ==========================================================================
# Templates (readable by authenticated users; authored by admin / mzk_manager)
# ==========================================================================
@router.get("/roadmap-templates", response_model=list[TemplateListItem])
async def list_templates(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    # Students need the read-only list for country UG/Graduate previews.
    res = await db.execute(select(RoadmapTemplate).options(_TEMPLATE_LOADER).order_by(RoadmapTemplate.created_at.desc()))
    items = []
    for t in res.scalars().all():
        task_count = sum(len(s.tasks) for s in t.stages)
        items.append(TemplateListItem(
            id=t.id, name=t.name, country_name=t.country_name, degree=t.degree,
            year=t.year, stage_count=len(t.stages), task_count=task_count,
            source_notion_db_id=t.source_notion_db_id,
            source_notion_title=t.source_notion_title,
            source_notion_last_edited_at=t.source_notion_last_edited_at,
        ))
    return items


@router.post("/roadmap-templates", response_model=TemplateOut, status_code=201)
async def create_template(body: TemplateCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_template_admin(current_user)
    tpl = RoadmapTemplate(
        name=body.name, country_name=body.country_name, degree=body.degree,
        year=body.year, description=body.description, created_by=current_user.id,
        source_notion_db_id=body.source_notion_db_id,
        source_notion_title=body.source_notion_title,
        source_notion_last_edited_at=body.source_notion_last_edited_at,
    )
    _apply_template_structure(tpl, body.stages)
    db.add(tpl)
    await db.commit()
    return await _get_template_or_404(db, tpl.id)


@router.post("/roadmap-templates/import/notion", status_code=202)
async def start_notion_roadmap_import(body: NotionRoadmapImportRequest, current_user: CurrentUser):
    _assert_template_admin(current_user)
    running = await background_jobs.get_running_job(_IMPORT_JOB_KIND)
    if running:
        raise HTTPException(status_code=409, detail={"message": "Импорт уже запущен", "job_id": str(running.id)})

    job = await background_jobs.create_job(
        _IMPORT_JOB_KIND,
        request=body.model_dump(),
        progress={
            "message": "Импорт Notion запущен",
            "template_index": 0,
            "template_total": 0,
            "task_index": 0,
            "task_total": 0,
        },
    )

    async def runner() -> None:
        from app.core.import_notion_root_roadmaps import run_import_summary

        on_event = background_jobs.make_on_event(job.id)
        try:
            result = await run_import_summary(
                dry_run=body.dry_run,
                only=body.only,
                discover_only=body.discover_only,
                skip_subtasks=body.skip_subtasks,
                on_event=on_event,
            )
            await background_jobs.finish_job(
                job.id, status="done" if result.ok else "failed", result=result.as_dict(), error=result.error,
            )
        except Exception as exc:
            await background_jobs.finish_job(job.id, status="failed", error=str(exc))

    asyncio.create_task(runner())
    return background_jobs.serialize(job)


@router.get("/roadmap-templates/import/notion/{job_id}")
async def get_notion_roadmap_import_job(job_id: str, current_user: CurrentUser):
    _assert_template_admin(current_user)
    job = await background_jobs.get_job(_IMPORT_JOB_KIND, job_id)
    if not job:
        raise _NOT_FOUND
    return background_jobs.serialize(job)


@router.get("/roadmap-templates/import/notion")
async def list_notion_roadmap_import_jobs(current_user: CurrentUser):
    _assert_template_admin(current_user)
    jobs = await background_jobs.list_jobs(_IMPORT_JOB_KIND, limit=10)
    return [background_jobs.serialize(job) for job in jobs]


@router.get("/roadmap-templates/{template_id}", response_model=TemplateOut)
async def get_template(template_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    # Read-only template detail powers the country preview in both cabinets.
    return await _get_template_or_404(db, template_id)


@router.patch("/roadmap-templates/{template_id}", response_model=TemplateOut)
async def update_template(template_id: uuid.UUID, body: TemplateMetaUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_template_admin(current_user)
    tpl = await _get_template_or_404(db, template_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tpl, field, value)
    await db.commit()
    return await _get_template_or_404(db, template_id)


@router.delete("/roadmap-templates/{template_id}", status_code=204)
async def delete_template(template_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_template_admin(current_user)
    tpl = await db.get(RoadmapTemplate, template_id)
    if not tpl:
        raise _NOT_FOUND
    await db.delete(tpl)
    await db.commit()


@router.put("/roadmap-templates/{template_id}/structure", response_model=TemplateOut)
async def put_structure(template_id: uuid.UUID, body: StructureIn, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _assert_template_admin(current_user)
    tpl = await _get_template_or_404(db, template_id)
    for s in list(tpl.stages):
        await db.delete(s)
    await db.flush()
    tpl.stages = []
    _apply_template_structure(tpl, body.stages)
    await db.commit()
    return await _get_template_or_404(db, template_id)


@router.post("/roadmap-templates/{template_id}/assign", response_model=RoadmapOut, status_code=201)
async def assign_template(template_id: uuid.UUID, body: AssignRequest, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    await _assert_staff(db, body.student_id, current_user)
    tpl = await _get_template_or_404(db, template_id)

    # A student can have several roadmaps active at once (e.g. parallel
    # applications to different countries/programs) — no longer blocked here.
    mentor_id = body.mentor_id
    if mentor_id is None and current_user.role == UserRole.mentor:
        mentor_id = current_user.id
    if mentor_id is None:
        mentor_id = await primary_mentor_id(db, body.student_id)
    if mentor_id is not None:
        await ensure_lead_assignment(db, body.student_id, mentor_id)

    roadmap = Roadmap(
        student_id=body.student_id, mentor_id=mentor_id, template_id=tpl.id,
        name=body.name or tpl.name, country_name=tpl.country_name,
        degree=tpl.degree, year=tpl.year,
    )
    db.add(roadmap)
    await db.flush()  # assign roadmap.id before creating children

    today = date.today()
    created_tasks: list[RoadmapTask] = []
    for ts in tpl.stages:
        stage = Stage(roadmap_id=roadmap.id, name=ts.name, description=ts.description, position=ts.position)
        db.add(stage)
        await db.flush()  # assign stage.id
        for tt in ts.tasks:
            due = today + timedelta(days=tt.due_offset_days) if tt.due_offset_days is not None else None
            task = RoadmapTask(
                stage_id=stage.id, roadmap_id=roadmap.id,
                title=tt.title, description=tt.description,
                expected_result=tt.expected_result,
                needs_document=tt.needs_document,
                needs_zoom=tt.needs_zoom,
                questionnaire_url=tt.questionnaire_url,
                priority=tt.priority,
                audience=tt.audience, due_date=due, position=tt.position, created_by=current_user.id,
            )
            task.subtasks = [RoadmapSubtask(title=st.title, position=st.position) for st in tt.subtasks]
            db.add(task)
            created_tasks.append(task)

    # Auto-attach native questionnaires (from Notion-imported templates) to tasks
    # that carry a form link, so anketas appear under the roadmap automatically.
    await db.flush()
    for task in created_tasks:
        await seed_questionnaire_for_task(db, task, current_user.id)

    await db.commit()
    return await _load_roadmap(db, roadmap.id)


# ==========================================================================
# Live roadmap — read
# ==========================================================================
@router.get("/students/{student_id}/roadmap", response_model=list[RoadmapOut])
async def get_student_roadmap(student_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """A student can have several roadmaps active at once — returns all of
    them, newest first."""
    await _assert_view(db, student_id, current_user)
    return await _active_roadmaps(db, student_id)


@router.get("/roadmaps/{roadmap_id}", response_model=RoadmapOut)
async def get_roadmap(roadmap_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """Fetch one specific roadmap by id — used to refresh a single roadmap
    after an edit, now that a student can have several active at once."""
    student_id = await _student_of_roadmap(db, roadmap_id)
    if student_id is None:
        raise _NOT_FOUND
    await _assert_view(db, student_id, current_user)
    roadmap = await _load_roadmap(db, roadmap_id)
    if roadmap is None:
        raise _NOT_FOUND
    return roadmap


@router.get("/portal/roadmap", response_model=list[RoadmapOut])
async def get_my_roadmap(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if current_user.role != UserRole.student:
        raise _FORBIDDEN
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    return await _active_roadmaps(db, sid)


@router.get("/students/{student_id}/tasks", response_model=list[TaskFlatOut])
async def get_student_tasks(student_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    await _assert_view(db, student_id, current_user)
    return _flatten_tasks(await _active_roadmaps(db, student_id))


@router.get("/portal/tasks", response_model=list[TaskFlatOut])
async def get_my_tasks(current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    if current_user.role != UserRole.student:
        raise _FORBIDDEN
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    return _flatten_tasks(await _active_roadmaps(db, sid))


@router.patch("/roadmaps/{roadmap_id}/archive", response_model=RoadmapOut)
async def archive_roadmap(roadmap_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    """Retires one of a student's roadmaps without deleting it — used when a
    student has several active roadmaps and one of them is no longer needed
    (e.g. an application track was dropped)."""
    student_id = await _student_of_roadmap(db, roadmap_id)
    if student_id is None:
        raise _NOT_FOUND
    await _assert_staff(db, student_id, current_user)
    roadmap = await db.get(Roadmap, roadmap_id)
    roadmap.status = RoadmapStatus.archived
    await db.commit()
    return await _load_roadmap(db, roadmap_id)


# ==========================================================================
# Live roadmap — mutations
# ==========================================================================
@router.patch("/stages/{stage_id}", response_model=RoadmapOut)
async def update_stage(stage_id: uuid.UUID, body: StageUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    stage = await db.get(Stage, stage_id)
    if not stage:
        raise _NOT_FOUND
    student_id = await _student_of_roadmap(db, stage.roadmap_id)
    # Roadmap is mentor-managed end to end — students only fill questionnaires
    # and view progress, they never edit stage/task status directly anymore.
    await _assert_staff(db, student_id, current_user)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(stage, field, value)
    await db.commit()
    return await _load_roadmap(db, stage.roadmap_id)


@router.post("/roadmap-tasks", response_model=RoadmapOut, status_code=201)
async def create_task(body: TaskCreate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    stage = await db.get(Stage, body.stage_id)
    if not stage:
        raise _NOT_FOUND
    student_id = await _student_of_roadmap(db, stage.roadmap_id)
    await _assert_staff(db, student_id, current_user)
    task = RoadmapTask(
        stage_id=stage.id, roadmap_id=stage.roadmap_id, title=body.title,
        description=body.description,
        expected_result=body.expected_result,
        needs_document=body.needs_document,
        needs_zoom=body.needs_zoom,
        questionnaire_url=body.questionnaire_url,
        priority=body.priority, audience=body.audience,
        due_date=body.due_date, created_by=current_user.id,
    )
    db.add(task)
    await db.commit()
    return await _load_roadmap(db, stage.roadmap_id)


@router.patch("/roadmap-tasks/{task_id}", response_model=RoadmapOut)
async def update_task(task_id: uuid.UUID, body: TaskUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    task = await db.get(RoadmapTask, task_id)
    if not task:
        raise _NOT_FOUND
    student_id = await _student_of_roadmap(db, task.roadmap_id)
    # Roadmap is mentor-managed end to end — students only fill questionnaires
    # and view progress, they never edit task status directly anymore.
    await _assert_staff(db, student_id, current_user)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(task, field, value)
    await db.commit()
    return await _load_roadmap(db, task.roadmap_id)


@router.delete("/roadmap-tasks/{task_id}", status_code=204)
async def delete_task(task_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    task = await db.get(RoadmapTask, task_id)
    if not task:
        raise _NOT_FOUND
    student_id = await _student_of_roadmap(db, task.roadmap_id)
    await _assert_staff(db, student_id, current_user)
    await db.delete(task)
    await db.commit()


@router.post("/roadmap-tasks/{task_id}/subtasks", response_model=RoadmapOut, status_code=201)
async def create_subtask(task_id: uuid.UUID, body: SubtaskIn, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    task = await db.get(RoadmapTask, task_id)
    if not task:
        raise _NOT_FOUND
    student_id = await _student_of_roadmap(db, task.roadmap_id)
    await _assert_staff(db, student_id, current_user)
    db.add(RoadmapSubtask(task_id=task.id, title=body.title))
    await db.commit()
    return await _load_roadmap(db, task.roadmap_id)


@router.patch("/roadmap-subtasks/{subtask_id}", response_model=RoadmapOut)
async def update_subtask(subtask_id: uuid.UUID, body: SubtaskUpdate, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    sub = await db.get(RoadmapSubtask, subtask_id)
    if not sub:
        raise _NOT_FOUND
    task = await db.get(RoadmapTask, sub.task_id)
    student_id = await _student_of_roadmap(db, task.roadmap_id)
    # Roadmap is mentor-managed end to end — students only fill questionnaires
    # and view progress, they never edit subtask status directly anymore.
    await _assert_staff(db, student_id, current_user)
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(sub, field, value)
    await db.commit()
    return await _load_roadmap(db, task.roadmap_id)


@router.delete("/roadmap-subtasks/{subtask_id}", status_code=204)
async def delete_subtask(subtask_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    sub = await db.get(RoadmapSubtask, subtask_id)
    if not sub:
        raise _NOT_FOUND
    task = await db.get(RoadmapTask, sub.task_id)
    student_id = await _student_of_roadmap(db, task.roadmap_id)
    await _assert_staff(db, student_id, current_user)
    await db.delete(sub)
    await db.commit()


# --------------------------------------------------------------------------
# internal helpers
# --------------------------------------------------------------------------
def _apply_template_structure(tpl: RoadmapTemplate, stages: list) -> None:
    for si, s in enumerate(stages):
        stage = TemplateStage(name=s.name, description=s.description, position=si)
        for ti, t in enumerate(s.tasks):
            task = TemplateTask(
                title=t.title, description=t.description,
                expected_result=t.expected_result,
                needs_document=t.needs_document,
                needs_zoom=t.needs_zoom,
                questionnaire_url=t.questionnaire_url,
                source_notion_page_id=t.source_notion_page_id,
                priority=t.priority,
                audience=t.audience, due_offset_days=t.due_offset_days, position=ti,
            )
            task.subtasks = [
                TemplateSubtask(title=st.title, position=sti, source_notion_page_id=st.source_notion_page_id)
                for sti, st in enumerate(t.subtasks)
            ]
            stage.tasks.append(task)
        tpl.stages.append(stage)


async def _get_template_or_404(db: AsyncSession, template_id: uuid.UUID) -> RoadmapTemplate:
    res = await db.execute(
        select(RoadmapTemplate).where(RoadmapTemplate.id == template_id).options(_TEMPLATE_LOADER)
    )
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise _NOT_FOUND
    return tpl


def _flatten_tasks(roadmaps: list[Roadmap]) -> list[TaskFlatOut]:
    out: list[TaskFlatOut] = []
    for roadmap in roadmaps:
        for stage in roadmap.stages:
            for task in stage.tasks:
                out.append(TaskFlatOut(
                    id=task.id, stage_id=task.stage_id, roadmap_id=task.roadmap_id,
                    stage_name=stage.name, stage_position=stage.position,
                    title=task.title, description=task.description,
                    expected_result=task.expected_result,
                    needs_document=task.needs_document,
                    needs_zoom=task.needs_zoom,
                    questionnaire_url=task.questionnaire_url,
                    priority=task.priority, audience=task.audience, status=task.status,
                    due_date=task.due_date, position=task.position,
                    subtasks=[RoadmapSubtaskOut.model_validate(st) for st in task.subtasks],
                ))
    return out


async def _active_roadmaps(db: AsyncSession, student_id: uuid.UUID) -> list[Roadmap]:
    """A student may have several roadmaps active at once (parallel
    applications to different countries/programs) — this returns all of
    them, newest first."""
    res = await db.execute(
        select(Roadmap)
        .where(Roadmap.student_id == student_id, Roadmap.status == RoadmapStatus.active)
        .order_by(Roadmap.created_at.desc())
        .options(_ROADMAP_LOADER)
    )
    roadmaps = list(res.scalars().all())
    for roadmap in roadmaps:
        await attach_flags(db, roadmap)
        await _attach_mentor_name(db, roadmap)
    return roadmaps


async def _attach_mentor_name(db: AsyncSession, roadmap: Roadmap | None) -> None:
    """Stamp a transient `mentor_name` attribute for RoadmapOut serialisation."""
    if roadmap is None:
        return
    roadmap.mentor_name = None
    if roadmap.mentor_id is None:
        return
    res = await db.execute(select(User.name).where(User.id == roadmap.mentor_id))
    roadmap.mentor_name = res.scalar_one_or_none()
