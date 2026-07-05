from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.application import Application, SubmissionStatus, VisaStatus
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole
from app.schemas.application import ApplicationCreate, ApplicationUpdate

router = APIRouter(prefix="/applications", tags=["applications"])


def _can_edit(user, student_id: uuid.UUID, mentor_ids: set[uuid.UUID]) -> bool:
    if user.role in (UserRole.admin, UserRole.mzk_manager):
        return True
    return student_id in mentor_ids


@router.post("")
async def create_application(
    body: ApplicationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    mentor_ids = await _get_mentor_ids(db, current_user.id)
    if not _can_edit(current_user, body.student_id, mentor_ids):
        raise HTTPException(status_code=403, detail="Access denied")

    app = Application(
        student_id=body.student_id,
        contract_id=body.contract_id,
        country=body.country.strip(),
        university=body.university,
        program=body.program,
        submissions_planned=body.submissions_planned,
        submissions_done=0,
        submission_status=body.submission_status,
        visa_status=body.visa_status,
        scholarship_target=body.scholarship_target,
        is_primary=body.is_primary,
        lead_mentor_id=body.lead_mentor_id,
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return _app_to_dict(app)


@router.patch("/{app_id}")
async def update_application(
    app_id: uuid.UUID,
    body: ApplicationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Application).where(Application.id == app_id))
    app = result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Подача не найдена")

    mentor_ids = await _get_mentor_ids(db, current_user.id)
    if not _can_edit(current_user, app.student_id, mentor_ids):
        raise HTTPException(status_code=403, detail="Access denied")

    updates = body.model_dump(exclude_unset=True)
    for field in ["country", "university", "program", "scholarship_target", "is_primary",
                  "submissions_planned", "submissions_done", "submission_status",
                  "visa_status", "lead_mentor_id", "contract_id"]:
        if field in updates:
            setattr(app, field, updates[field])

    await db.commit()
    await db.refresh(app)
    return _app_to_dict(app)


@router.delete("/{app_id}")
async def delete_application(
    app_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(select(Application).where(Application.id == app_id))
    app = result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Подача не найдена")
    await db.delete(app)
    await db.commit()
    return {"message": "Deleted"}


async def _get_mentor_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(
        select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == user_id,
            MentorAssignment.is_active == True,  # noqa
        )
    )
    return {row[0] for row in result.all()}


def _app_to_dict(a: Application) -> dict:
    return {
        "id": str(a.id),
        "student_id": str(a.student_id),
        "contract_id": str(a.contract_id) if a.contract_id else None,
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
