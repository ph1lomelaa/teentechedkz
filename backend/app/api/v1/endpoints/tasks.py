from __future__ import annotations
import math
import uuid
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import CurrentUser, require_permission
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
from app.services.task_urgency import task_urgency
from app.core.uploads import read_upload_capped
from app.services.minio_service import minio_upload

router = APIRouter(prefix="/tasks", tags=["tasks"])
TASK_PRIORITIES = {"low", "normal", "high", "urgent"}
EVIDENCE_MIME_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
EVIDENCE_MAX_FILE_SIZE = 25 * 1024 * 1024


def _validate_task_acceptance(current_user: User, assignee_id: uuid.UUID | None) -> None:
    try:
        require_permission(current_user, "accept_mentor_results")
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
    scope: str = Query("all", pattern="^(all|mine)$"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
):
    """Return all tasks the current user can see, with student name included."""
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
        if not student_ids:
            return {"items": [], "total": 0, "page": page, "size": size, "pages": 0}
        query = query.where(StudentTask.student_id.in_(student_ids))

    if scope == "mine" and mentor_id is None:
        query = query.where(StudentTask.assignee_id == current_user.id)

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
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
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
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")

    student_id = uuid.UUID(body["student_id"])
    assignee_id = uuid.UUID(body["assignee_id"]) if body.get("assignee_id") else None
    assignee = None
    if assignee_id:
        assignee = await db.get(User, assignee_id)
        if not assignee or not assignee.is_active:
            raise HTTPException(status_code=404, detail="Исполнитель не найден или неактивен")
        if assignee.role not in (UserRole.mentor, UserRole.mzk_manager):
            raise HTTPException(status_code=422, detail="Исполнителем может быть ментор или МЗК")
        require_permission(
            current_user,
            "assign_mentor_tasks" if assignee.role == UserRole.mentor else "assign_mzk_tasks",
        )
        if assignee.role == UserRole.mentor:
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
        require_permission(current_user, "manage_deadlines")
        due_date = date.fromisoformat(body["due_date"])

    task = StudentTask(
        student_id=student_id,
        service_id=uuid.UUID(body["service_id"]) if body.get("service_id") else None,
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

    student = await db.get(Student, student_id)
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


@router.patch("/{task_id}")
async def update_task(
    task_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
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
        task.service_id = uuid.UUID(body["service_id"]) if body["service_id"] else None
    for field in ("expected_result", "acceptance_criteria"):
        if field in body:
            setattr(task, field, body[field])
    if "required_documents" in body:
        if body["required_documents"] is not None and not isinstance(body["required_documents"], list):
            raise HTTPException(status_code=422, detail="required_documents должен быть списком")
        task.required_documents = body["required_documents"]
    if "result_text" in body:
        if current_user.id != task.assignee_id and current_user.role not in (UserRole.admin, UserRole.mzk_manager):
            raise HTTPException(status_code=403, detail="Результат может изменить только исполнитель")
        task.result_text = body["result_text"]
    if "review_note" in body:
        if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
            raise HTTPException(status_code=403, detail="Комментарий проверки доступен только reviewer")
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
            assignee = await db.get(User, uuid.UUID(body["assignee_id"]))
            if not assignee or not assignee.is_active:
                raise HTTPException(status_code=404, detail="Исполнитель не найден или неактивен")
            if assignee.role not in (UserRole.mentor, UserRole.mzk_manager):
                raise HTTPException(status_code=422, detail="Исполнителем может быть ментор или МЗК")
            require_permission(
                current_user,
                "assign_mentor_tasks" if assignee.role == UserRole.mentor else "assign_mzk_tasks",
            )
            if assignee.role == UserRole.mentor:
                await _validate_mentor_task_scope(db, task.student_id, assignee.id)
        task.assignee_id = assignee.id if assignee else None
        if assignee and await has_pending_agreement_signature(db, assignee):
            task.status = TaskStatus.awaiting_signature

    if "due_date" in body:
        require_permission(current_user, "manage_deadlines")
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
        task.status = new_status
        now = datetime.now(timezone.utc)
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
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
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

    storage_path = await minio_upload(
        content=content,
        student_id=task.student_id,
        filename=f"task_{task.id}_{file.filename or 'evidence'}",
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
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
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
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
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
        "student_id": str(t.student_id),
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
