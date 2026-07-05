from __future__ import annotations
import uuid
import math
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.core.encryption import mask_iin, decrypt
from app.models.student import Student, DegreeLevel, IntakeSeason
from app.models.contract import Contract
from app.models.mentor_assignment import MentorAssignment
from app.models.guardian import Guardian
from app.models.confidential_note import ConfidentialNote
from app.models.user import UserRole
from app.schemas.student import StudentCreate, StudentUpdate

router = APIRouter(prefix="/students", tags=["students"])


def _can_see_student(current_user, student_id: uuid.UUID, mentor_student_ids: set[uuid.UUID]) -> bool:
    if current_user.role in (UserRole.admin, UserRole.mzk_manager):
        return True
    return student_id in mentor_student_ids


async def _get_mentor_student_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(
        select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == user_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
    )
    return {row[0] for row in result.all()}


async def _student_responsibles(
    db: AsyncSession,
    student_id: uuid.UUID,
    current_user_id: uuid.UUID,
) -> tuple[list[dict], bool]:
    result = await db.execute(
        select(MentorAssignment)
        .options(selectinload(MentorAssignment.mentor))
        .where(MentorAssignment.student_id == student_id)
        .order_by(MentorAssignment.assigned_at.desc())
    )
    assignments = result.scalars().all()
    responsibles = [
        {
            "id": str(a.mentor_id),
            "assignment_id": str(a.id),
            "name": a.mentor.name if a.mentor else None,
            "role": a.role.value,
            "is_active": a.is_active,
        }
        for a in assignments
    ]
    is_mine = any(a.mentor_id == current_user_id and a.is_active for a in assignments)
    return responsibles, is_mine


@router.get("")
async def list_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    search: str | None = None,
    pipeline_status: str | None = None,
    intake_year: int | None = None,
    mzk_manager_id: uuid.UUID | None = None,
    country: str | None = None,
    mentor_id: uuid.UUID | None = None,
    scope: str = Query("all", pattern="^(all|mine|unassigned)$"),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=500),
):
    from app.models.application import Application

    query = select(Student).where(Student.is_archived == False)  # noqa: E712

    if scope == "mine":
        query = query.join(
            MentorAssignment,
            MentorAssignment.student_id == Student.id,
        ).where(
            MentorAssignment.mentor_id == current_user.id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
    elif scope == "unassigned":
        assigned_subquery = select(MentorAssignment.student_id).where(
            MentorAssignment.is_active == True,  # noqa: E712
        )
        query = query.where(Student.id.not_in(assigned_subquery))

    if search:
        query = query.where(
            or_(
                Student.full_name.ilike(f"%{search}%"),
                Student.phone.ilike(f"%{search}%"),
            )
        )

    if intake_year:
        query = query.where(Student.intake_year == intake_year)

    if pipeline_status or mzk_manager_id:
        query = query.join(Contract, Contract.student_id == Student.id, isouter=True)
        if pipeline_status:
            from app.models.contract import PipelineStatus
            try:
                query = query.where(Contract.pipeline_status == PipelineStatus(pipeline_status))
            except ValueError:
                pass
        if mzk_manager_id:
            query = query.where(Contract.mzk_manager_id == mzk_manager_id)

    if country:
        query = query.join(Application, Application.student_id == Student.id, isouter=True)
        query = query.where(Application.country.ilike(f"%{country}%"))

    if mentor_id:
        query = query.join(
            MentorAssignment,
            MentorAssignment.student_id == Student.id,
            isouter=True,
        ).where(
            MentorAssignment.mentor_id == mentor_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    query = query.order_by(Student.full_name).offset((page - 1) * size).limit(size).distinct()
    result = await db.execute(query)
    students = result.scalars().all()

    items = []
    for s in students:
        contract_result = await db.execute(
            select(Contract).where(Contract.student_id == s.id).order_by(Contract.created_at.desc()).limit(1)
        )
        contract = contract_result.scalar_one_or_none()
        days_in_work = None
        pipeline_status_val = None
        if contract:
            if contract.signed_date:
                days_in_work = (date.today() - contract.signed_date).days
            pipeline_status_val = contract.pipeline_status.value if contract.pipeline_status else None

        responsibles, is_mine = await _student_responsibles(db, s.id, current_user.id)
        items.append({
            "id": str(s.id),
            "full_name": s.full_name,
            "phone": s.phone,
            "city": s.city,
            "degree_level": s.degree_level.value,
            "intake_year": s.intake_year,
            "pipeline_status": pipeline_status_val,
            "days_in_work": days_in_work,
            "is_mine": is_mine,
            "responsibles": responsibles,
            "responsible_count": len([r for r in responsibles if r["is_active"]]),
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "size": size,
        "pages": math.ceil(total / size) if total > 0 else 0,
    }


@router.post("")
async def create_student(
    body: StudentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    phone = body.phone.strip()
    existing = await db.execute(select(Student).where(Student.phone == phone))
    existing_student = existing.scalar_one_or_none()
    if existing_student:
        raise HTTPException(
            status_code=409,
            detail="Студент с таким номером уже существует",
            headers={"X-Existing-Id": str(existing_student.id)},
        )

    student = Student(
        full_name=body.full_name.strip(),
        phone=phone,
        city=body.city,
        age=body.age,
        degree_level=body.degree_level,
        specialty=body.specialty,
        group_direction=body.group_direction,
        additional_sphere=body.additional_sphere,
        gpa=body.gpa,
        achievements_text=body.achievements_text,
        budget_per_year=body.budget_per_year,
        transcript_resume_url=body.transcript_resume_url,
        intake_year=body.intake_year,
        intake_season=body.intake_season,
    )
    db.add(student)
    await db.flush()

    await log_change(
        db, "student", student.id, "created", None, student.full_name,
        str(current_user.id), "manual"
    )
    await db.commit()
    await db.refresh(student)
    return _student_to_dict(student)


@router.get("/{student_id}")
async def get_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(Student)
        .where(Student.is_archived == False)  # noqa: E712
        .options(
            selectinload(Student.contracts).selectinload(Contract.payments),
            selectinload(Student.applications),
            selectinload(Student.mentor_assignments),
            selectinload(Student.services),
            selectinload(Student.portfolio_progress),
            selectinload(Student.documents),
            selectinload(Student.student_tasks),
            selectinload(Student.communication_logs),
            selectinload(Student.pending_insights),
            selectinload(Student.notes),
        )
        .where(Student.id == student_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    data = _student_to_dict(student)
    responsibles, is_mine = await _student_responsibles(db, student.id, current_user.id)
    data["responsibles"] = responsibles
    data["is_mine"] = is_mine

    # Product mode: role is not an access boundary; "mine" is a work filter.
    if current_user.role in (UserRole.admin, UserRole.mzk_manager, UserRole.lead_mentor, UserRole.mentor):
        guardian_result = await db.execute(
            select(Guardian).where(Guardian.student_id == student_id)
        )
        guardians = guardian_result.scalars().all()
        data["guardians"] = [
            {
                "id": str(g.id),
                "full_name": g.full_name,
                "iin_masked": mask_iin(_decrypt_safe(g.iin_encrypted)) if g.iin_encrypted else None,
                "phone": g.phone,
                "email": g.email,
                "relation": g.relation.value,
                "is_primary": g.is_primary,
            }
            for g in guardians
        ]

        conf_result = await db.execute(
            select(ConfidentialNote)
            .where(ConfidentialNote.student_id == student_id)
            .order_by(ConfidentialNote.created_at)
        )
        conf_notes = conf_result.scalars().all()
        data["confidential_notes"] = [
            {
                "id": str(c.id),
                "note_text": _decrypt_safe(c.note_text_encrypted),
                "visible_to_role": c.visible_to_role.value,
                "created_by": str(c.created_by),
                "created_at": c.created_at.isoformat(),
            }
            for c in conf_notes
        ]

        contract_data = []
        for c in student.contracts:
            contract_data.append({
                "id": str(c.id),
                "signed_date": c.signed_date.isoformat() if c.signed_date else None,
                "amount": str(c.amount) if c.amount else None,
                "currency": c.currency,
                "payment_plan": c.payment_plan.value if c.payment_plan else None,
                "pipeline_status": c.pipeline_status.value if c.pipeline_status else None,
                "mzk_manager_id": str(c.mzk_manager_id) if c.mzk_manager_id else None,
                "ielts_payment_included": c.ielts_payment_included,
                "english_sum": str(c.english_sum) if c.english_sum else None,
                "english_paid": str(c.english_paid) if c.english_paid else None,
                "client_remaining_amount": str(c.client_remaining_amount) if c.client_remaining_amount else None,
                "client_remaining_date": c.client_remaining_date.isoformat() if c.client_remaining_date else None,
                "mentor_total_owed": str(c.mentor_total_owed) if c.mentor_total_owed else None,
                "notes": c.notes,
                "created_at": c.created_at.isoformat(),
                "payments": [
                    {
                        "id": str(p.id),
                        "type": p.type.value,
                        "amount": str(p.amount),
                        "currency": p.currency,
                        "status": p.status.value,
                        "paid_at": p.paid_at.isoformat() if p.paid_at else None,
                        "mentor_id": str(p.mentor_id) if p.mentor_id else None,
                        "note": p.note,
                    }
                    for p in c.payments
                ],
            })
        data["contracts"] = contract_data
    else:
        data["contracts"] = []
        data["guardians"] = []
        data["confidential_notes"] = []

    return data


@router.patch("/{student_id}")
async def update_student(
    student_id: uuid.UUID,
    body: StudentUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    updates = body.model_dump(exclude_unset=True)
    scalar_fields = [
        "full_name", "phone", "city", "age", "specialty", "group_direction",
        "additional_sphere", "gpa", "achievements_text", "budget_per_year",
        "transcript_resume_url", "intake_year", "degree_level", "intake_season",
    ]
    for field in scalar_fields:
        if field in updates:
            old_val = getattr(student, field)
            new_val = updates[field]
            if old_val != new_val:
                await log_change(db, "student", student.id, field, str(old_val), str(new_val), str(current_user.id))
            setattr(student, field, new_val)

    student.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(student)
    return _student_to_dict(student)


@router.delete("/{student_id}")
async def archive_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Только администратор может архивировать студентов")
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    student.is_archived = True
    await log_change(db, "student", student.id, "is_archived", "false", "true", str(current_user.id))
    await db.commit()
    return {"message": "Студент архивирован"}


def _student_to_dict(s: Student) -> dict:
    return {
        "id": str(s.id),
        "full_name": s.full_name,
        "phone": s.phone,
        "city": s.city,
        "age": s.age,
        "degree_level": s.degree_level.value,
        "specialty": s.specialty,
        "group_direction": s.group_direction,
        "additional_sphere": s.additional_sphere,
        "gpa": s.gpa,
        "achievements_text": s.achievements_text,
        "budget_per_year": s.budget_per_year,
        "transcript_resume_url": s.transcript_resume_url,
        "intake_year": s.intake_year,
        "intake_season": s.intake_season.value if s.intake_season else None,
        "is_archived": s.is_archived,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
        "applications": [
            {
                "id": str(a.id),
                "country": a.country,
                "university": a.university,
                "program": a.program,
                "submissions_planned": a.submissions_planned,
                "submissions_done": a.submissions_done,
                "submission_status": a.submission_status.value,
                "visa_status": a.visa_status.value if a.visa_status else None,
                "scholarship_target": a.scholarship_target,
                "is_primary": a.is_primary,
                "lead_mentor_id": str(a.lead_mentor_id) if a.lead_mentor_id else None,
            }
            for a in (s.applications if s.applications else [])
        ],
        "services": [
            {
                "id": str(svc.id),
                "service_type": svc.service_type.value,
                "included": svc.included,
                "status": svc.status.value,
                "result": svc.result,
                "assigned_mentor_id": str(svc.assigned_mentor_id) if svc.assigned_mentor_id else None,
                "notes": svc.notes,
                "portfolio_directions_count": svc.portfolio_directions_count,
                "portfolio_directions_types": svc.portfolio_directions_types,
                "proforientation_specialty": svc.proforientation_specialty,
            }
            for svc in (s.services if s.services else [])
        ],
        "portfolio_progress": {
            "id": str(s.portfolio_progress.id),
            "vpp_group": s.portfolio_progress.vpp_group,
            "first_call_milestone": s.portfolio_progress.first_call_milestone,
            "deadline_text": s.portfolio_progress.deadline_text,
            "focus_areas": s.portfolio_progress.focus_areas or [],
            "status": s.portfolio_progress.status.value,
            "achievements_count": s.portfolio_progress.achievements_count,
            "calls_count": s.portfolio_progress.calls_count,
            "special_notes": s.portfolio_progress.special_notes,
        } if s.portfolio_progress else None,
        "documents": [
            {
                "id": str(d.id),
                "doc_type": d.doc_type.value,
                "file_name": d.file_name,
                "file_size": d.file_size,
                "mime_type": d.mime_type,
                "source": d.source.value,
                "ai_description": d.ai_description,
                "is_verified": d.is_verified,
                "uploaded_at": d.uploaded_at.isoformat(),
            }
            for d in (s.documents if s.documents else [])
        ],
        "student_tasks": [
            {
                "id": str(t.id),
                "task_text": t.task_text,
                "status": t.status.value,
                "created_by": str(t.created_by),
                "created_at": t.created_at.isoformat(),
                "done_at": t.done_at.isoformat() if t.done_at else None,
            }
            for t in (s.student_tasks if s.student_tasks else [])
        ],
        "mentor_assignments": [
            {
                "id": str(ma.id),
                "mentor_id": str(ma.mentor_id),
                "role": ma.role.value,
                "country_scope": ma.country_scope,
                "is_active": ma.is_active,
            }
            for ma in (s.mentor_assignments if s.mentor_assignments else [])
        ],
        "communication_logs": [
            {
                "id": str(cl.id),
                "source": cl.source.value,
                "message_type": cl.message_type.value,
                "raw_text": cl.raw_text,
                "ai_summary": cl.ai_summary,
                "zoom_call_date": cl.zoom_call_date.isoformat() if cl.zoom_call_date else None,
                "created_at": cl.created_at.isoformat(),
            }
            for cl in (s.communication_logs if s.communication_logs else [])
        ],
        "pending_insights": [
            {
                "id": str(pi.id),
                "insight_type": pi.insight_type.value,
                "proposed_changes": pi.proposed_changes,
                "confidence": float(pi.confidence),
                "risk_level": pi.risk_level.value,
                "status": pi.status.value,
                "created_at": pi.created_at.isoformat(),
            }
            for pi in (s.pending_insights if s.pending_insights else [])
        ],
        "notes": [
            {
                "id": str(n.id),
                "student_id": str(n.student_id) if n.student_id else None,
                "student_name": s.full_name,
                "title": n.title,
                "source_text": n.source_text,
                "summary_markdown": n.summary_markdown,
                "profile_snapshot": n.profile_snapshot or {},
                "suggested_changes": n.suggested_changes or {},
                "applied_changes": n.applied_changes or {},
                "status": n.status.value,
                "created_by": str(n.created_by) if n.created_by else None,
                "reviewed_by": str(n.reviewed_by) if n.reviewed_by else None,
                "created_at": n.created_at.isoformat(),
                "reviewed_at": n.reviewed_at.isoformat() if n.reviewed_at else None,
            }
            for n in sorted((s.notes if s.notes else []), key=lambda item: item.created_at, reverse=True)
        ],
    }


def _decrypt_safe(ciphertext: str | None) -> str | None:
    if not ciphertext:
        return None
    try:
        return decrypt(ciphertext)
    except Exception:
        return "[decrypt error]"
