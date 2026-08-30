from __future__ import annotations
import math
import uuid
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import joinedload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, allows, require_access
from app.core.body import optional_uuid, required_uuid
from app.models.student_task import StudentTask, TaskStatus
from app.models.contract import Contract
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole
from app.models.student import Student
from app.models.user import User
from app.models.notification import Notification
from app.models.status_history import StatusHistory
from app.models.task_evidence import TaskEvidence
from app.services.agreements import has_pending_agreement_signature
from app.services.task_sla import (
    PAUSED_STATUSES,
    TERMINAL_STATUSES,
    compute_sla_due_at,
    is_overdue,
)
from app.services.task_urgency import task_urgency
from app.core.uploads import read_upload_capped
from app.services.minio_service import minio_upload, minio_upload_task

router = APIRouter(prefix="/tasks", tags=["tasks"])
TASK_PRIORITIES = {"low", "normal", "high", "urgent"}
EVIDENCE_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
EVIDENCE_MAX_FILE_SIZE = 25 * 1024 * 1024


def _validate_task_acceptance(current_user: User, assignee_id: uuid.UUID | None) -> None:
    try:
        require_access(current_user, "tasks_accept_result", Action.manage)
    except HTTPException:
        raise HTTPException(
            status_code=403,
            detail="Результат может принять только МЗК или администратор",
            headers={"X-Error-Code": "TASK_ACCEPTANCE_FORBIDDEN"},
        )
    if assignee_id == current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Исполнитель не может принять собственный результат",
            headers={"X-Error-Code": "TASK_SELF_ACCEPTANCE_FORBIDDEN"},
        )


@router.get("")
async def list_all_tasks(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    status: str | None = None,
    mentor_id: uuid.UUID | None = None,
    assignee_id: uuid.UUID | None = None,
    overdue: bool | None = None,
    kind: str = Query("all", pattern="^(all|student|general)$"),
    scope: str = Query("all", pattern="^(all|mine)$"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
):
    """Return all tasks the current user can see, with student name included.

    Доска МЗК (`/workspace/mentor-tasks`) ходит сюда же: `assignee_id` даёт
    срез по конкретному ментору, `overdue=true` — только горящие, `kind`
    разделяет задачи по студенту и общие.
    """
    query = select(StudentTask).options(
        joinedload(StudentTask.student),
        joinedload(StudentTask.assignee),
    )

    if mentor_id and current_user.role == UserRole.mentor and mentor_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    scoped_mentor_id = current_user.id if (current_user.role == UserRole.mentor or (scope == "mine" and mentor_id is None)) else mentor_id
    if scoped_mentor_id is not None:
        assigned = await db.execute(
            select(MentorAssignment.student_id).where(
                MentorAssignment.mentor_id == scoped_mentor_id,
                MentorAssignment.is_active == True,  # noqa: E712
            )
        )
        student_ids = {row[0] for row in assigned.all()}
        contract_result = await db.execute(
            select(Contract.student_id).where(Contract.mzk_manager_id == scoped_mentor_id)
        )
        student_ids.update(row[0] for row in contract_result.all())
        # Общая задача не привязана к студенту, поэтому скоуп «по студентам»
        # её бы отсёк: исполнителю она видна по assignee_id. Без этого ментор
        # не увидел бы собственные общие задачи вовсе.
        scope_filter = StudentTask.assignee_id == scoped_mentor_id
        if student_ids:
            scope_filter = or_(StudentTask.student_id.in_(student_ids), scope_filter)
        query = query.where(scope_filter)

    if scope == "mine" and mentor_id is None:
        query = query.where(StudentTask.assignee_id == current_user.id)

    if assignee_id is not None:
        if current_user.role == UserRole.mentor and assignee_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied")
        query = query.where(StudentTask.assignee_id == assignee_id)

    if kind == "student":
        query = query.where(StudentTask.student_id.isnot(None))
    elif kind == "general":
        query = query.where(StudentTask.student_id.is_(None))

    if overdue is not None:
        # Просрочка считается тем же предикатом, что и в фоновом цикле:
        # дедлайн в прошлом и задача ещё в работе.
        live = StudentTask.status.notin_(list(TERMINAL_STATUSES | PAUSED_STATUSES))
        burning = and_(
            StudentTask.sla_due_at.isnot(None),
            StudentTask.sla_due_at <= datetime.now(timezone.utc),
            live,
        )
        query = query.where(burning if overdue else ~burning)

    if status:
        try:
            query = query.where(StudentTask.status == TaskStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")

    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar() or 0

    query = query.order_by(StudentTask.created_at.desc()).offset((page - 1) * size).limit(size)
    result = await db.execute(query)
    tasks = result.scalars().all()

    return {
        "items": [_task_to_dict(t, include_student=True) for t in tasks],
        "total": total,
        "page": page,
        "size": size,
        "pages": math.ceil(total / size) if total > 0 else 0,
    }


@router.get("/student/{student_id}")
async def get_tasks(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "tasks", Action.manage)
    result = await db.execute(
        select(StudentTask).options(joinedload(StudentTask.assignee))
        .where(StudentTask.student_id == student_id)
        .order_by(StudentTask.created_at.desc())
    )
    tasks = result.scalars().all()
    return [_task_to_dict(t) for t in tasks]


@router.post("")
async def create_task(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "tasks", Action.manage)

    # student_id опционален: МЗК/админ ставит менторам и общие задачи
    # («сдай отчёт»), не привязанные к конкретному студенту.
    student_id = optional_uuid(body, "student_id")
    if student_id is None:
        require_access(current_user, "tasks_general", Action.manage)
    assignee_id = optional_uuid(body, "assignee_id")
    assignee = None
    if assignee_id:
        assignee = await db.get(User, assignee_id)
        if not assignee or not assignee.is_active:
            raise HTTPException(status_code=404, detail="Исполнитель не найден или неактивен")
        if assignee.role not in (UserRole.mentor, UserRole.mzk_manager):
            raise HTTPException(status_code=422, detail="Исполнителем может быть ментор или МЗК")
        require_access(
            current_user,
            "tasks_assign_mentor" if assignee.role == UserRole.mentor else "tasks_assign_mzk",
            Action.manage,
        )
        # Проверка назначения применима только к задаче по студенту: у общей
        # задачи нет студента, на которого ментора можно было бы назначить.
        if assignee.role == UserRole.mentor and student_id is not None:
            await _validate_mentor_task_scope(db, student_id, assignee.id)

    requested_status = body.get("status")
    try:
        status = TaskStatus(requested_status) if requested_status else TaskStatus.open
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверный статус")

    if assignee and await has_pending_agreement_signature(db, assignee):
        status = TaskStatus.awaiting_signature

    priority = body.get("priority", "normal")
    if priority not in TASK_PRIORITIES:
        raise HTTPException(status_code=422, detail="Неверный приоритет задачи")
    required_documents = body.get("required_documents")
    if required_documents is not None and not isinstance(required_documents, list):
        raise HTTPException(status_code=422, detail="required_documents должен быть списком")
    due_date = None
    if body.get("due_date"):
        require_access(current_user, "tasks_deadlines", Action.manage)
        due_date = date.fromisoformat(body["due_date"])

    # SLA: по умолчанию 24 часа на задачу с исполнителем (регламент менторов,
    # раздел 6). Явный null отключает SLA — бывают задачи без срока.
    if "sla_hours" in body:
        sla_hours = body["sla_hours"]
        if sla_hours is not None:
            if not isinstance(sla_hours, int) or sla_hours <= 0:
                raise HTTPException(status_code=422, detail="sla_hours должен быть положительным числом")
    else:
        sla_hours = settings.TASK_SLA_DEFAULT_HOURS if assignee else None
    created_at = datetime.now(timezone.utc)
    # Заперт гейтом регламента — часы SLA не стартуют: отсчёт начнётся, когда
    # исполнитель подпишет и задача выйдет из awaiting_signature (см. PATCH
    # ниже). Иначе человек копил бы просрочку за время, когда работать не мог.
    sla_due_at = (
        None
        if status == TaskStatus.awaiting_signature
        else compute_sla_due_at(created_at=created_at, sla_hours=sla_hours)
    )

    task = StudentTask(
        student_id=student_id,
        sla_hours=sla_hours,
        sla_due_at=sla_due_at,
        service_id=optional_uuid(body, "service_id"),
        task_text=body.get("task_text", "").strip(),
        expected_result=body.get("expected_result"),
        acceptance_criteria=body.get("acceptance_criteria"),
        required_documents=required_documents,
        priority=priority,
        created_by=current_user.id,
        assignee_id=assignee.id if assignee else None,
        status=status,
        due_date=due_date,
        original_due_date=due_date,
        due_date_set_by=current_user.id if due_date else None,
    )
    db.add(task)

    student = await db.get(Student, student_id) if student_id else None
    if student and student.user_id:
        db.add(Notification(
            user_id=student.user_id,
            kind="task_assigned",
            title="Новая задача",
            body=task.task_text,
            link="/portal/tasks",
            priority="normal",
        ))
    if assignee:
        db.add(Notification(
            user_id=assignee.id,
            kind="task_assigned",
            title="Вам назначена задача",
            body=task.task_text,
            link="/workspace/tasks",
            priority="normal",
        ))

    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


@router.post("/bulk")
async def create_tasks_bulk(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Одна задача сразу нескольким исполнителям.

    Каждому создаётся своя строка, а не одна общая на всех: у задач разные
    исполнители, свои сроки SLA и свои санкции за просрочку — «одна задача с
    несколькими ответственными» ломала бы и то, и другое.

    `assignee_ids: []` вместе с `all_mentors: true` означает «всем активным
    менторам» — на момент создания, без доназначения тем, кто появится позже.
    """
    require_access(current_user, "tasks_bulk", Action.manage)

    raw_ids = body.get("assignee_ids") or []
    if not isinstance(raw_ids, list):
        raise HTTPException(status_code=422, detail="assignee_ids должен быть списком")

    roles_wanted: list[UserRole] = []
    if body.get("all_mentors"):
        roles_wanted.append(UserRole.mentor)
    if body.get("all_mzk"):
        roles_wanted.append(UserRole.mzk_manager)

    assignee_ids: list[uuid.UUID] = []
    for value in raw_ids:
        try:
            assignee_ids.append(uuid.UUID(str(value)))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Некорректный id исполнителя: {value}")

    if roles_wanted:
        rows = await db.execute(
            select(User.id).where(
                User.role.in_(roles_wanted),
                User.is_active == True,  # noqa: E712
            )
        )
        assignee_ids.extend(rows.scalars().all())

    # Один и тот же человек мог попасть и списком, и через «всем менторам» —
    # иначе он получил бы две одинаковые задачи с двумя SLA.
    unique_ids = list(dict.fromkeys(assignee_ids))
    if not unique_ids:
        raise HTTPException(status_code=422, detail="Не выбран ни один исполнитель")

    created: list[dict] = []
    skipped: list[dict] = []
    for assignee_id in unique_ids:
        payload = {**body, "assignee_id": str(assignee_id)}
        payload.pop("assignee_ids", None)
        payload.pop("all_mentors", None)
        payload.pop("all_mzk", None)
        try:
            created.append(await create_task(payload, db, current_user))
        except HTTPException as exc:
            # Один неподходящий исполнитель (не в скоупе студента, деактивирован)
            # не должен рушить всю рассылку — остальные задачи создаются.
            await db.rollback()
            skipped.append({"assignee_id": str(assignee_id), "reason": str(exc.detail)})

    if not created:
        raise HTTPException(
            status_code=422,
            detail={"message": "Ни одна задача не создана", "skipped": skipped},
            headers={"X-Error-Code": "BULK_ASSIGN_EMPTY"},
        )
    return {"created": created, "skipped": skipped, "created_count": len(created)}


@router.patch("/{task_id}")
async def update_task(
    task_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "tasks", Action.manage)
    result = await db.execute(
        select(StudentTask).options(joinedload(StudentTask.assignee)).where(StudentTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    previous_status = task.status

    if "task_text" in body:
        task.task_text = body["task_text"]
    if "service_id" in body:
        task.service_id = optional_uuid(body, "service_id")
    for field in ("expected_result", "acceptance_criteria"):
        if field in body:
            setattr(task, field, body[field])
    if "required_documents" in body:
        if body["required_documents"] is not None and not isinstance(body["required_documents"], list):
            raise HTTPException(status_code=422, detail="required_documents должен быть списком")
        task.required_documents = body["required_documents"]
    if "result_text" in body:
        is_assignee = current_user.id == task.assignee_id
        if not is_assignee and not allows(
            resource="tasks_review", action=Action.manage, role=current_user.role
        ):
            raise HTTPException(status_code=403, detail="Результат может изменить только исполнитель")
        task.result_text = body["result_text"]
    if "review_note" in body:
        require_access(current_user, "tasks_review", Action.manage)
        task.review_note = body["review_note"]
    if "evidence_documents" in body:
        if body["evidence_documents"] is not None and not isinstance(body["evidence_documents"], list):
            raise HTTPException(status_code=422, detail="evidence_documents должен быть списком")
        task.evidence_documents = body["evidence_documents"]
    if "priority" in body:
        if body["priority"] not in TASK_PRIORITIES:
            raise HTTPException(status_code=422, detail="Неверный приоритет задачи")
        task.priority = body["priority"]

    if "assignee_id" in body:
        assignee = None
        if body["assignee_id"]:
            assignee = await db.get(User, required_uuid(body, "assignee_id"))
            if not assignee or not assignee.is_active:
                raise HTTPException(status_code=404, detail="Исполнитель не найден или неактивен")
            if assignee.role not in (UserRole.mentor, UserRole.mzk_manager):
                raise HTTPException(status_code=422, detail="Исполнителем может быть ментор или МЗК")
            require_access(
                current_user,
                "tasks_assign_mentor" if assignee.role == UserRole.mentor else "tasks_assign_mzk",
                Action.manage,
            )
            # У общей задачи нет студента, на которого ментора можно было бы
            # назначить — проверка скоупа к ней неприменима.
            if assignee.role == UserRole.mentor and task.student_id is not None:
                await _validate_mentor_task_scope(db, task.student_id, assignee.id)
        task.assignee_id = assignee.id if assignee else None
        if assignee and await has_pending_agreement_signature(db, assignee):
            task.status = TaskStatus.awaiting_signature

    if "due_date" in body:
        require_access(current_user, "tasks_deadlines", Action.manage)
        task.due_date = date.fromisoformat(body["due_date"]) if body["due_date"] else None
        if task.original_due_date is None and task.due_date is not None:
            task.original_due_date = task.due_date
        task.due_date_set_by = current_user.id if task.due_date else None

    if "status" in body:
        try:
            new_status = TaskStatus(body["status"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")
        if new_status == TaskStatus.accepted:
            _validate_task_acceptance(current_user, task.assignee_id)
            required_documents = set(task.required_documents or [])
            if required_documents:
                evidence_result = await db.execute(
                    select(TaskEvidence.requirement).where(TaskEvidence.task_id == task.id)
                )
                uploaded_requirements = {row[0] for row in evidence_result.all() if row[0]}
                missing_documents = sorted(required_documents - uploaded_requirements)
                if missing_documents:
                    raise HTTPException(
                        status_code=409,
                        detail={"message": "Не загружены обязательные подтверждения", "missing": missing_documents},
                        headers={"X-Error-Code": "TASK_EVIDENCE_REQUIRED"},
                    )
        if new_status in (
            TaskStatus.in_progress,
            TaskStatus.submitted,
            TaskStatus.accepted,
        ) and task.assignee_id:
            assignee = await db.get(User, task.assignee_id)
            if assignee and await has_pending_agreement_signature(db, assignee):
                raise HTTPException(
                    status_code=403,
                    detail="Исполнитель не может начать работу до подписания регламента",
                    headers={"X-Error-Code": "ASSIGNEE_AGREEMENT_REQUIRED"},
                )
        was_paused = task.status in PAUSED_STATUSES
        task.status = new_status
        now = datetime.now(timezone.utc)
        # Гейт регламента снят — только теперь стартуют часы SLA: до этого
        # исполнитель был заперт и работать не мог.
        if was_paused and new_status not in PAUSED_STATUSES and task.sla_due_at is None:
            task.sla_due_at = compute_sla_due_at(created_at=now, sla_hours=task.sla_hours)
        if new_status == TaskStatus.submitted:
            task.submitted_at = now
            task.submitted_by = current_user.id
            reviewers = await db.execute(
                select(User.id).where(
                    User.role.in_((UserRole.admin, UserRole.mzk_manager)),
                    User.is_active == True,  # noqa: E712
                    User.id != current_user.id,
                )
            )
            for reviewer_id in reviewers.scalars().all():
                db.add(Notification(
                    user_id=reviewer_id,
                    kind="task_submitted",
                    title="Результат задачи ждёт проверки",
                    body=task.task_text,
                    link="/workspace/tasks",
                    priority="normal",
                ))
        elif new_status == TaskStatus.accepted:
            task.accepted_at = now
            task.accepted_by = current_user.id
        if new_status == TaskStatus.done and not task.done_at:
            task.done_at = datetime.now(timezone.utc)
        elif new_status == TaskStatus.open:
            task.done_at = None

    if task.status != previous_status:
        db.add(StatusHistory(
            entity_type="student_task",
            entity_id=task.id,
            field_changed="status",
            old_value=previous_status.value,
            new_value=task.status.value,
            changed_by=str(current_user.id),
            source="tasks_api",
        ))

    await db.commit()
    await db.refresh(task)
    return _task_to_dict(task)


async def _validate_mentor_task_scope(
    db: AsyncSession,
    student_id: uuid.UUID,
    mentor_id: uuid.UUID,
) -> None:
    assignment = await db.execute(
        select(MentorAssignment.id).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.mentor_id == mentor_id,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.assignment_status == "active",
        )
    )
    if assignment.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=409,
            detail="Ментор не имеет активного назначения на этого студента",
            headers={"X-Error-Code": "TASK_ASSIGNEE_OUT_OF_SCOPE"},
        )


@router.post("/{task_id}/evidence")
async def upload_task_evidence(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    file: UploadFile = File(...),
    requirement: str | None = Form(None),
):
    require_access(current_user, "tasks", Action.manage)
    task = await db.get(StudentTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if current_user.role == UserRole.mentor and task.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="Только исполнитель может загрузить подтверждение")
    if task.assignee_id:
        assignee = await db.get(User, task.assignee_id)
        if assignee and await has_pending_agreement_signature(db, assignee):
            raise HTTPException(status_code=403, detail="Сначала подпишите регламент")

    content = await read_upload_capped(file, EVIDENCE_MAX_FILE_SIZE)
    mime = file.content_type or "application/octet-stream"
    if mime not in EVIDENCE_MIME_TYPES:
        raise HTTPException(status_code=422, detail=f"Недопустимый тип файла: {mime}")
    if requirement and task.required_documents and requirement not in task.required_documents:
        raise HTTPException(status_code=422, detail="Документ не указан среди обязательных")

    # У общей задачи студента нет, а minio_upload кладёт файл в students/{id}/ —
    # без отдельной ветки путь стал бы буквально "students/None/...".
    filename = f"task_{task.id}_{file.filename or 'evidence'}"
    if task.student_id is not None:
        storage_path = await minio_upload(
            content=content,
            student_id=task.student_id,
            filename=filename,
            mime_type=mime,
        )
    else:
        storage_path = await minio_upload_task(
            content=content,
            task_id=task.id,
            filename=filename,
            mime_type=mime,
        )
    evidence = TaskEvidence(
        task_id=task.id,
        uploaded_by=current_user.id,
        file_name=file.filename or "evidence",
        requirement=requirement,
        file_size=len(content),
        mime_type=mime,
        storage_path=storage_path,
    )
    db.add(evidence)
    await db.commit()
    await db.refresh(evidence)
    return _evidence_to_dict(evidence)


@router.get("/{task_id}/evidence")
async def list_task_evidence(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "tasks", Action.manage)
    task = await db.get(StudentTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if current_user.role == UserRole.mentor and task.assignee_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет доступа к подтверждениям этой задачи")
    result = await db.execute(
        select(TaskEvidence).where(TaskEvidence.task_id == task_id).order_by(TaskEvidence.uploaded_at.desc())
    )
    return [_evidence_to_dict(evidence) for evidence in result.scalars().all()]


@router.delete("/{task_id}")
async def delete_task(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "tasks", Action.manage)
    result = await db.execute(
        select(StudentTask).options(joinedload(StudentTask.assignee)).where(StudentTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    await db.delete(task)
    await db.commit()
    return {"message": "Deleted"}


def _task_to_dict(t: StudentTask, include_student: bool = False) -> dict:
    d = {
        "id": str(t.id),
        # None у общей задачи без студента — иначе на фронт уезжала бы строка
        # "None" вместо null.
        "student_id": str(t.student_id) if t.student_id else None,
        "service_id": str(t.service_id) if t.service_id else None,
        "task_text": t.task_text,
        "expected_result": t.expected_result,
        "acceptance_criteria": t.acceptance_criteria,
        "required_documents": t.required_documents,
        "result_text": t.result_text,
        "evidence_documents": t.evidence_documents,
        "priority": t.priority,
        "created_by": str(t.created_by),
        "assignee_id": str(t.assignee_id) if t.assignee_id else None,
        "assignee_name": t.assignee.name if t.assignee else None,
        "status": t.status.value,
        "created_at": t.created_at.isoformat(),
        "done_at": t.done_at.isoformat() if t.done_at else None,
        "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None,
        "submitted_by": str(t.submitted_by) if t.submitted_by else None,
        "accepted_at": t.accepted_at.isoformat() if t.accepted_at else None,
        "accepted_by": str(t.accepted_by) if t.accepted_by else None,
        "review_note": t.review_note,
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "original_due_date": t.original_due_date.isoformat() if t.original_due_date else None,
        "due_date_set_by": str(t.due_date_set_by) if t.due_date_set_by else None,
        "urgency": task_urgency(t.due_date, t.status.value),
        "sla_hours": t.sla_hours,
        "sla_due_at": t.sla_due_at.isoformat() if t.sla_due_at else None,
        "sla_penalty_color": t.sla_penalty_color,
        # Считается на лету: клиенту нужен признак «горит сейчас», а не на
        # момент последнего прохода фонового цикла.
        "sla_overdue": is_overdue(
            sla_due_at=t.sla_due_at, status=t.status, now=datetime.now(timezone.utc)
        ),
    }
    if include_student and t.student:
        d["student_name"] = t.student.full_name
    return d


def _evidence_to_dict(evidence: TaskEvidence) -> dict:
    return {
        "id": str(evidence.id),
        "task_id": str(evidence.task_id),
        "uploaded_by": str(evidence.uploaded_by),
        "file_name": evidence.file_name,
        "requirement": evidence.requirement,
        "file_size": evidence.file_size,
        "mime_type": evidence.mime_type,
        "uploaded_at": evidence.uploaded_at.isoformat(),
    }
