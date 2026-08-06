from __future__ import annotations
import uuid
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.service import Service, ServiceType, ServiceStatus
from app.models.mentor_assignment import MentorAssignment
from app.models.student_task import StudentTask, TaskStatus
from app.models.user import User, UserRole
from app.services.mentor_scope import require_student_access

router = APIRouter(prefix="/services", tags=["services"])

SERVICE_ROLE_MAP = {
    ServiceType.proforientation: {"career"},
    ServiceType.ielts_mock: {"ielts"},
    ServiceType.ielts_prep: {"ielts"},
    ServiceType.sat_prep: {"sat"},
    ServiceType.portfolio_improvement: {"portfolio"},
    ServiceType.english_general: {"english"},
}


@router.get("/eligible-assignees")
async def list_eligible_assignees(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    await _check_access(db, current_user, student_id)
    result = await db.execute(
        select(User.id, User.name, MentorAssignment.role, func.count(MentorAssignment.id))
        .join(MentorAssignment, MentorAssignment.mentor_id == User.id)
        .where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.assignment_status == "active",
            User.is_active == True,  # noqa: E712
        )
        .group_by(User.id, User.name, MentorAssignment.role)
        .order_by(User.name)
    )
    return [
        {"id": str(user_id), "name": name, "role": role.value, "active_assignments": active_assignments}
        for user_id, name, role, active_assignments in result.all()
    ]


@router.post("")
async def create_service(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    try:
        student_id = uuid.UUID(body["student_id"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=422, detail="Неверный student_id")
    await _check_access(db, current_user, student_id)

    try:
        svc_type = ServiceType(body["service_type"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=422, detail="Неверный service_type")

    # Одна услуга каждого типа на студента (uq_services_student_service_type).
    # Ловим здесь, чтобы вернуть понятный 409 вместо ошибки целостности.
    existing = await db.execute(
        select(Service.id).where(
            Service.student_id == student_id,
            Service.service_type == svc_type,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Такая услуга у студента уже есть")

    try:
        status = ServiceStatus(body.get("status", "not_started"))
    except ValueError:
        raise HTTPException(status_code=422, detail="Неверный статус услуги")

    assigned_mentor_id = uuid.UUID(body.get("assigned_mentor_id") or body.get("assigned_staff_id")) if (body.get("assigned_mentor_id") or body.get("assigned_staff_id")) else None
    if assigned_mentor_id:
        await _validate_service_assignee(db, student_id, svc_type, assigned_mentor_id)

    svc = Service(
        student_id=student_id,
        contract_id=uuid.UUID(body["contract_id"]) if body.get("contract_id") else None,
        service_type=svc_type,
        included=body.get("included", False),
        status=status,
        result=body.get("result"),
        assigned_mentor_id=assigned_mentor_id,
        deadline=date.fromisoformat(body["deadline"]) if body.get("deadline") else None,
        notes=body.get("notes"),
        portfolio_directions_count=body.get("portfolio_directions_count"),
        portfolio_directions_types=body.get("portfolio_directions_types"),
        proforientation_specialty=body.get("proforientation_specialty"),
    )
    db.add(svc)
    await db.commit()
    await db.refresh(svc)
    return _svc_to_dict(svc)


@router.patch("/{service_id}")
async def update_service(
    service_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Service).where(Service.id == service_id))
    svc = result.scalar_one_or_none()
    if not svc:
        raise HTTPException(status_code=404, detail="Услуга не найдена")

    await _check_access(db, current_user, svc.student_id)

    for field in ["included", "result", "notes", "portfolio_directions_count", "portfolio_directions_types", "proforientation_specialty"]:
        if field in body:
            setattr(svc, field, body[field])

    if "status" in body:
        try:
            svc.status = ServiceStatus(body["status"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус услуги")
        if svc.status == ServiceStatus.completed:
            required_tasks = await db.execute(
                select(StudentTask.id).where(
                    StudentTask.service_id == svc.id,
                    StudentTask.priority == "required",
                    StudentTask.status != TaskStatus.accepted,
                )
            )
            incomplete_count = len(required_tasks.all())
            if incomplete_count:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Услугу нельзя завершить: обязательные задачи ещё не приняты",
                        "incomplete_required_tasks": incomplete_count,
                    },
                    headers={"X-Error-Code": "SERVICE_REQUIRED_TASKS_INCOMPLETE"},
                )
    if "assigned_mentor_id" in body:
        svc.assigned_mentor_id = uuid.UUID(body["assigned_mentor_id"]) if body["assigned_mentor_id"] else None
        if svc.assigned_mentor_id:
            await _validate_service_assignee(db, svc.student_id, svc.service_type, svc.assigned_mentor_id)
    if "assigned_staff_id" in body:
        svc.assigned_mentor_id = uuid.UUID(body["assigned_staff_id"]) if body["assigned_staff_id"] else None
        if svc.assigned_mentor_id:
            await _validate_service_assignee(db, svc.student_id, svc.service_type, svc.assigned_mentor_id)
    if "deadline" in body:
        svc.deadline = date.fromisoformat(body["deadline"]) if body["deadline"] else None

    svc.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(svc)
    return _svc_to_dict(svc)


async def _check_access(db: AsyncSession, user, student_id: uuid.UUID) -> None:
    """Роль + доступ именно к этому студенту.

    Раньше проверялась только роль, а student_id игнорировался — любой ментор
    мог править услуги любого студента. require_student_access ограничивает
    ментора его назначениями (админ и МЗК проходят насквозь).
    """
    if user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
        raise HTTPException(status_code=403, detail="Access denied")
    await require_student_access(db, student_id, user)


async def _validate_service_assignee(
    db: AsyncSession,
    student_id: uuid.UUID,
    service_type: ServiceType,
    mentor_id: uuid.UUID,
) -> None:
    assignment = await db.execute(
        select(MentorAssignment.role).where(
            MentorAssignment.student_id == student_id,
            MentorAssignment.mentor_id == mentor_id,
            MentorAssignment.is_active == True,  # noqa: E712
            MentorAssignment.assignment_status == "active",
        )
    )
    roles = {row[0].value for row in assignment.all()}
    expected = SERVICE_ROLE_MAP[service_type]
    if not roles.intersection(expected):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Исполнитель не имеет активной роли для этой услуги",
                "service_type": service_type.value,
                "required_roles": sorted(expected),
            },
            headers={"X-Error-Code": "SERVICE_ASSIGNEE_ROLE_MISMATCH"},
        )


def _svc_to_dict(s: Service) -> dict:
    return {
        "id": str(s.id),
        "student_id": str(s.student_id),
        "contract_id": str(s.contract_id) if s.contract_id else None,
        "service_type": s.service_type.value,
        "included": s.included,
        "status": s.status.value,
        "result": s.result,
        "assigned_mentor_id": str(s.assigned_mentor_id) if s.assigned_mentor_id else None,
        "assigned_staff_id": str(s.assigned_mentor_id) if s.assigned_mentor_id else None,
        "deadline": s.deadline.isoformat() if s.deadline else None,
        "notes": s.notes,
        "portfolio_directions_count": s.portfolio_directions_count,
        "portfolio_directions_types": s.portfolio_directions_types,
        "proforientation_specialty": s.proforientation_specialty,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }
