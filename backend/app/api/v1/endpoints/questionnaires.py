"""Native questionnaire API — structured forms attached to roadmap tasks.

Flow: staff build questions on a task's questionnaire (draft) → send to student →
student fills it in their cabinet (submitted) → mentor reviews (reviewed). Sending
notifies the student; submitting notifies the mentor.
"""
from __future__ import annotations

import uuid
import asyncio
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal, get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.services import background_jobs
from app.core.import_notion_questionnaires import (
    _form_question_configs,
    _legacy_rich_text_plain,
    _public_form_payload,
)
from app.models.user import UserRole
from app.models.student import Student
from app.models.roadmap import RoadmapTask, Roadmap
from app.models.notification import Notification
from app.models.questionnaire import (
    Questionnaire, QuestionnaireQuestion, QuestionnaireResponse, QuestionnaireStatus, QuestionKind,
)
from app.models.questionnaire_template import QuestionnaireTemplate
from app.schemas.questionnaire import (
    QuestionnaireCreate, QuestionnaireUpdate, QuestionsPut, RespondIn,
)
from app.services.mentor_scope import require_student_access, primary_mentor_id

router = APIRouter(tags=["questionnaire"])

_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})
_NOT_FOUND = HTTPException(status_code=404, detail="Не найдено")

_LOADER = (selectinload(Questionnaire.questions), selectinload(Questionnaire.response))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _answered(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, list):
        return len(value) > 0
    return bool(value) or value is False  # a False bool answer still counts as answered


async def _my_student_id(db: AsyncSession, user) -> uuid.UUID | None:
    res = await db.execute(select(Student.id).where(Student.user_id == user.id))
    return res.scalar_one_or_none()


async def _load(db: AsyncSession, qid: uuid.UUID) -> Questionnaire | None:
    res = await db.execute(select(Questionnaire).where(Questionnaire.id == qid).options(*_LOADER))
    return res.scalar_one_or_none()


async def _load_for_update(db: AsyncSession, qid: uuid.UUID) -> Questionnaire | None:
    """Row-locked variant of _load() for the submit path: a concurrent double
    submit must serialize on this row instead of racing past the status check.
    """
    res = await db.execute(
        select(Questionnaire).where(Questionnaire.id == qid).options(*_LOADER).with_for_update()
    )
    return res.scalar_one_or_none()


async def _hydrate_notion_help_text(db: AsyncSession, q: Questionnaire) -> None:
    """Lazily cache captions for a form the first time it is opened.

    This keeps initial roadmap assignment fast while ensuring every linked
    Notion form eventually gets its real question descriptions.
    """
    if not q.source_notion_page_id or not any(not item.help_text.strip() for item in q.questions):
        return
    tpl = (
        await db.execute(
            select(QuestionnaireTemplate).where(
                QuestionnaireTemplate.source_notion_db_id == q.source_notion_page_id
            )
        )
    ).scalar_one_or_none()
    if not tpl or not tpl.source_form_block_id:
        return
    payload = await asyncio.to_thread(_public_form_payload, tpl.source_form_block_id)
    configs = _form_question_configs(payload)
    if not configs:
        return
    captions = {
        _legacy_rich_text_plain(config.get("name")).casefold(): _legacy_rich_text_plain(config.get("description"))
        for config in configs
    }
    changed = False
    for item in q.questions:
        caption = captions.get(item.label.strip().casefold(), "")
        if caption and not item.help_text.strip():
            item.help_text = caption
            changed = True
    if changed:
        tpl.questions = [
            {
                **item,
                "help_text": item.get("help_text")
                or captions.get(str(item.get("label", "")).strip().casefold(), ""),
            }
            for item in (tpl.questions or [])
        ]
        await db.commit()


async def _hydrate_notion_help_text_bg(qid: uuid.UUID) -> None:
    """Background-task entry point: opens its own session so it can outlive the request."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(Questionnaire).where(Questionnaire.id == qid).options(selectinload(Questionnaire.questions))
        )
        q = res.scalar_one_or_none()
        if q:
            await _hydrate_notion_help_text(db, q)


async def _student_of_task(db: AsyncSession, task: RoadmapTask) -> uuid.UUID | None:
    res = await db.execute(select(Roadmap.student_id).where(Roadmap.id == task.roadmap_id))
    return res.scalar_one_or_none()


async def _assert_staff_scope(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    require_access(user, "questionnaires", Action.manage)
    await require_student_access(db, student_id, user)


async def _assert_view(db: AsyncSession, q: Questionnaire, user) -> None:
    require_access(user, "questionnaires", Action.view)
    if user.role == UserRole.student:
        if await _my_student_id(db, user) != q.student_id:
            raise _NOT_FOUND
        return
    await _assert_staff_scope(db, q.student_id, user)


def _serialize(q: Questionnaire) -> dict:
    answers = (q.response.answers if q.response else {}) or {}
    return {
        "id": str(q.id),
        "roadmap_task_id": str(q.roadmap_task_id) if q.roadmap_task_id else None,
        "student_id": str(q.student_id),
        "title": q.title,
        "description": q.description,
        "status": q.status.value,
        "source_notion_page_id": q.source_notion_page_id,
        "created_at": q.created_at.isoformat(),
        "sent_at": q.sent_at.isoformat() if q.sent_at else None,
        "submitted_at": q.submitted_at.isoformat() if q.submitted_at else None,
        "reviewed_at": q.reviewed_at.isoformat() if q.reviewed_at else None,
        "questions": [
            {
                "id": str(x.id),
                "kind": x.kind.value,
                "label": x.label,
                "help_text": x.help_text,
                "required": x.required,
                "options": x.options or [],
                "position": x.position,
            }
            for x in q.questions
        ],
        "answers": answers,
        "has_response": q.response is not None,
    }


# ==========================================================================
# Staff — build / manage
# ==========================================================================
@router.post("/roadmap-tasks/{task_id}/questionnaire", status_code=201)
async def create_questionnaire(
    task_id: uuid.UUID, body: QuestionnaireCreate, current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task = await db.get(RoadmapTask, task_id)
    if not task:
        raise _NOT_FOUND
    student_id = await _student_of_task(db, task)
    if not student_id:
        raise _NOT_FOUND
    await _assert_staff_scope(db, student_id, current_user)

    existing = await db.execute(select(Questionnaire.id).where(Questionnaire.roadmap_task_id == task_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="У задачи уже есть анкета")

    q = Questionnaire(
        roadmap_task_id=task_id, student_id=student_id,
        title=body.title, description=body.description,
        source_notion_page_id=body.source_notion_page_id, created_by=current_user.id,
    )
    for i, qq in enumerate(body.questions):
        q.questions.append(QuestionnaireQuestion(
            kind=qq.kind, label=qq.label, help_text=qq.help_text,
            required=qq.required, options=qq.options, position=i,
        ))
    db.add(q)
    await db.commit()
    return _serialize(await _load(db, q.id))


@router.get("/roadmap-tasks/{task_id}/questionnaire")
async def get_task_questionnaire(
    task_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    res = await db.execute(
        select(Questionnaire).where(Questionnaire.roadmap_task_id == task_id).options(*_LOADER)
    )
    q = res.scalar_one_or_none()
    if q:
        await _assert_view(db, q, current_user)
        # Opening a saved questionnaire must not depend on a live Notion
        # request, so any caption backfill runs after the response is sent
        # (its own DB session, no added latency for the viewer).
        if q.source_notion_page_id:
            background_tasks.add_task(_hydrate_notion_help_text_bg, q.id)
        return _serialize(q)
    # No questionnaire yet — still gate the probe on task access, then return null.
    task = await db.get(RoadmapTask, task_id)
    if not task:
        return None
    student_id = await _student_of_task(db, task)
    if student_id is None:
        return None
    if current_user.role == UserRole.student:
        if await _my_student_id(db, current_user) != student_id:
            raise _NOT_FOUND
    else:
        await _assert_staff_scope(db, student_id, current_user)
    return None


@router.get("/questionnaires/{qid}")
async def get_questionnaire(
    qid: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
    background_tasks: BackgroundTasks,
):
    q = await _load(db, qid)
    if not q:
        raise _NOT_FOUND
    await _assert_view(db, q, current_user)
    if q.source_notion_page_id:
        background_tasks.add_task(_hydrate_notion_help_text_bg, q.id)
    return _serialize(q)


@router.patch("/questionnaires/{qid}")
async def update_questionnaire(
    qid: uuid.UUID, body: QuestionnaireUpdate, current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    q = await _load(db, qid)
    if not q:
        raise _NOT_FOUND
    await _assert_staff_scope(db, q.student_id, current_user)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(q, field, value)
    await db.commit()
    return _serialize(await _load(db, qid))


@router.put("/questionnaires/{qid}/questions")
async def put_questions(
    qid: uuid.UUID, body: QuestionsPut, current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    q = await _load(db, qid)
    if not q:
        raise _NOT_FOUND
    await _assert_staff_scope(db, q.student_id, current_user)
    q.questions.clear()
    await db.flush()
    for i, qq in enumerate(body.questions):
        db.add(QuestionnaireQuestion(
            questionnaire_id=q.id, kind=qq.kind, label=qq.label, help_text=qq.help_text,
            required=qq.required, options=qq.options, position=i,
        ))
    await db.commit()
    return _serialize(await _load(db, qid))


@router.post("/questionnaires/{qid}/send")
async def send_questionnaire(
    qid: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
):
    q = await _load(db, qid)
    if not q:
        raise _NOT_FOUND
    await _assert_staff_scope(db, q.student_id, current_user)
    if not q.questions:
        raise HTTPException(status_code=400, detail="Добавьте хотя бы один вопрос перед отправкой")
    q.status = QuestionnaireStatus.sent
    q.sent_at = _now()
    student = await db.get(Student, q.student_id)
    if student and student.user_id:
        db.add(Notification(
            user_id=student.user_id, kind="roadmap",
            title="Новая анкета", body=q.title, link="/portal/tasks", priority="high",
        ))
    await db.commit()
    return _serialize(await _load(db, qid))


@router.post("/questionnaires/{qid}/review")
async def review_questionnaire(
    qid: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
):
    q = await _load(db, qid)
    if not q:
        raise _NOT_FOUND
    await _assert_staff_scope(db, q.student_id, current_user)
    q.status = QuestionnaireStatus.reviewed
    q.reviewed_at = _now()
    await db.commit()
    return _serialize(await _load(db, qid))


# ==========================================================================
# Student — fill
# ==========================================================================
@router.post("/questionnaires/{qid}/respond")
async def respond_questionnaire(
    qid: uuid.UUID, body: RespondIn, current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    q = await _load_for_update(db, qid)
    if not q:
        raise _NOT_FOUND
    if current_user.role != UserRole.student or await _my_student_id(db, current_user) != q.student_id:
        raise _FORBIDDEN
    if q.status == QuestionnaireStatus.draft:
        raise HTTPException(status_code=400, detail="Анкета ещё не отправлена")
    if q.status in {QuestionnaireStatus.submitted, QuestionnaireStatus.reviewed}:
        raise HTTPException(status_code=409, detail="Анкета уже отправлена и доступна только для просмотра")

    if body.submit:
        missing = [x.label for x in q.questions if x.required and not _answered(body.answers.get(str(x.id)))]
        if missing:
            raise HTTPException(
                status_code=400,
                detail={"message": "Заполните обязательные вопросы", "missing": missing},
            )

    if q.response is None:
        q.response = QuestionnaireResponse(answers=body.answers)
    else:
        q.response.answers = body.answers

    if body.submit:
        q.status = QuestionnaireStatus.submitted
        q.submitted_at = _now()
        mentor_id = await primary_mentor_id(db, q.student_id)
        if mentor_id:
            db.add(Notification(
                user_id=mentor_id, kind="task",
                title="Студент заполнил анкету", body=q.title,
                link=f"/workspace/students/{q.student_id}#roadmap", priority="high",
            ))
    await db.commit()
    return _serialize(await _load(db, qid))


# ==========================================================================
# Templates (imported from Notion) — pick to populate a task's questionnaire
# ==========================================================================
@router.get("/questionnaire-templates")
async def list_questionnaire_templates(
    current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = None, country: str | None = None,
):
    require_access(current_user, "questionnaires", Action.manage)
    stmt = select(QuestionnaireTemplate).order_by(QuestionnaireTemplate.title)
    if q:
        stmt = stmt.where(QuestionnaireTemplate.title.ilike(f"%{q}%"))
    if country:
        stmt = stmt.where(QuestionnaireTemplate.country_name.ilike(f"%{country}%"))
    res = await db.execute(stmt)
    return [
        {
            "id": str(t.id),
            "title": t.title,
            "country_name": t.country_name,
            "degree": t.degree,
            "step_name": t.step_name,
            "question_count": len(t.questions or []),
        }
        for t in res.scalars().all()
    ]


# --------------------------------------------------------------------------
# Notion sync — resolve form captions + attach questionnaires to tasks.
# Job state is persisted in background_jobs (kind="questionnaire_sync") so it
# survives a backend restart, instead of living only in a process-local dict.
# --------------------------------------------------------------------------
_SYNC_JOB_KIND = "questionnaire_sync"


@router.post("/questionnaires/sync/notion", status_code=202)
async def start_notion_questionnaire_sync(current_user: CurrentUser):
    require_access(current_user, "questionnaires", Action.manage)
    running = await background_jobs.get_running_job(_SYNC_JOB_KIND)
    if running:
        raise HTTPException(status_code=409, detail={"message": "Синхронизация уже запущена", "job_id": str(running.id)})

    job = await background_jobs.create_job(_SYNC_JOB_KIND)

    async def runner() -> None:
        from app.core.link_notion_questionnaires import run as run_link

        on_event = background_jobs.make_on_event(job.id)
        try:
            result = await run_link(on_event=on_event)
            await background_jobs.finish_job(job.id, status="done", result=result)
        except Exception as exc:
            await background_jobs.finish_job(job.id, status="failed", error=str(exc))

    asyncio.create_task(runner())
    return background_jobs.serialize(job)


@router.get("/questionnaires/sync/notion/{job_id}")
async def get_notion_questionnaire_sync_job(job_id: str, current_user: CurrentUser):
    require_access(current_user, "questionnaires", Action.manage)
    job = await background_jobs.get_job(_SYNC_JOB_KIND, job_id)
    if not job:
        raise _NOT_FOUND
    return background_jobs.serialize(job)


@router.post("/roadmap-tasks/{task_id}/questionnaire/from-template/{template_id}")
async def apply_template(
    task_id: uuid.UUID, template_id: uuid.UUID, current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task = await db.get(RoadmapTask, task_id)
    if not task:
        raise _NOT_FOUND
    student_id = await _student_of_task(db, task)
    if not student_id:
        raise _NOT_FOUND
    await _assert_staff_scope(db, student_id, current_user)
    tpl = await db.get(QuestionnaireTemplate, template_id)
    if not tpl:
        raise _NOT_FOUND

    res = await db.execute(
        select(Questionnaire).where(Questionnaire.roadmap_task_id == task_id).options(*_LOADER)
    )
    q = res.scalar_one_or_none()
    if q is None:
        q = Questionnaire(
            roadmap_task_id=task_id, student_id=student_id, title=tpl.title,
            source_notion_page_id=tpl.source_notion_db_id, created_by=current_user.id,
        )
        db.add(q)
        await db.flush()
    else:
        q.questions.clear()
        await db.flush()
    for i, item in enumerate(tpl.questions or []):
        db.add(QuestionnaireQuestion(
            questionnaire_id=q.id,
            kind=QuestionKind(item.get("kind", "text")),
            label=item.get("label", ""),
            help_text=item.get("help_text") or item.get("description") or "",
            required=bool(item.get("required")),
            options=item.get("options") or [],
            position=i,
        ))
    await db.commit()
    return _serialize(await _load(db, q.id))


@router.get("/portal/questionnaires")
async def my_questionnaires(
    current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)],
):
    require_access(current_user, "portal", Action.view)
    sid = await _my_student_id(db, current_user)
    if not sid:
        raise HTTPException(status_code=404, detail="К аккаунту не привязана карточка студента")
    res = await db.execute(
        select(Questionnaire)
        .where(Questionnaire.student_id == sid, Questionnaire.status != QuestionnaireStatus.draft)
        .options(*_LOADER)
        .order_by(Questionnaire.sent_at.desc().nullslast())
    )
    return [_serialize(q) for q in res.scalars().all()]
