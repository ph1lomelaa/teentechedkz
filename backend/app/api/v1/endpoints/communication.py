from __future__ import annotations
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.communication_log import CommunicationLog, CommSource, MessageType
from app.models.pending_insight import PendingInsight, InsightStatus
from app.models.student import Student
from app.models.user import UserRole
from app.core.audit import log_change
from app.services.mentor_scope import mentor_assigned_student_ids
from app.services.student_notes import apply_student_updates, build_profile_diff, snapshot_student

router = APIRouter(prefix="/communications", tags=["communications"])


@router.get("/student/{student_id}")
async def get_logs(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(CommunicationLog)
        .where(CommunicationLog.student_id == student_id)
        .order_by(CommunicationLog.created_at.desc())
    )
    logs = result.scalars().all()
    return [_log_to_dict(l) for l in logs]


@router.post("")
async def create_log(
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    try:
        source = CommSource(body.get("source", "manual"))
        msg_type = MessageType(body.get("message_type", "text_event"))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    log = CommunicationLog(
        student_id=uuid.UUID(body["student_id"]),
        source=source,
        message_type=msg_type,
        raw_text=body.get("raw_text"),
        ai_summary=body.get("ai_summary"),
        zoom_call_date=date.fromisoformat(body["zoom_call_date"]) if body.get("zoom_call_date") else None,
        zoom_duration_min=body.get("zoom_duration_min"),
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)
    return _log_to_dict(log)


@router.get("/pending-insights")
async def list_all_pending_insights(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    status: str | None = None,
):
    query = select(PendingInsight).order_by(PendingInsight.created_at.desc())
    if status:
        try:
            query = query.where(PendingInsight.status == InsightStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")

    result = await db.execute(query)
    insights = result.scalars().all()

    allowed_ids = await mentor_assigned_student_ids(db, current_user)

    out = []
    for insight in insights:
        if allowed_ids is not None and insight.student_id not in allowed_ids:
            continue
        student = await db.get(Student, insight.student_id)
        insight_dict = _insight_to_dict(insight)
        insight_dict["student_name"] = student.full_name if student else None
        if insight.status == InsightStatus.pending and student:
            insight_dict["diff"] = build_profile_diff(snapshot_student(student), insight.proposed_changes or {})
        else:
            insight_dict["diff"] = [
                {"field": field, "old_value": None, "new_value": value}
                for field, value in (insight.proposed_changes or {}).items()
            ]
        out.append(insight_dict)
    return out


@router.get("/pending-insights/student/{student_id}")
async def get_pending_insights(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(
        select(PendingInsight)
        .where(
            PendingInsight.student_id == student_id,
            PendingInsight.status == InsightStatus.pending,
        )
        .order_by(PendingInsight.created_at.desc())
    )
    insights = result.scalars().all()
    return [_insight_to_dict(i) for i in insights]


@router.post("/pending-insights/{insight_id}/review")
async def review_insight(
    insight_id: uuid.UUID,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(PendingInsight).where(PendingInsight.id == insight_id))
    insight = result.scalar_one_or_none()
    if not insight:
        raise HTTPException(status_code=404, detail="Инсайт не найден")

    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        allowed_ids = await mentor_assigned_student_ids(db, current_user)
        if allowed_ids is None or insight.student_id not in allowed_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    action = body.get("action")
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=422, detail="action должен быть 'approve' или 'reject'")
    if insight.status != InsightStatus.pending:
        raise HTTPException(status_code=409, detail="Инсайт уже проверен")

    from datetime import datetime, timezone
    insight.reviewed_by = current_user.id
    insight.reviewed_at = datetime.now(timezone.utc)

    if action == "reject":
        insight.status = InsightStatus.rejected
        await db.commit()
        await db.refresh(insight)
        return _insight_to_dict(insight)

    insight.status = InsightStatus.approved
    student = await db.get(Student, insight.student_id)
    if student:
        applied_changes = apply_student_updates(student, insight.proposed_changes or {})
        for change in applied_changes:
            await log_change(
                db,
                "student",
                student.id,
                change["field"],
                change["old_value"],
                change["new_value"],
                str(current_user.id),
                source="pending_insight",
            )
        if applied_changes:
            student.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(insight)
    return _insight_to_dict(insight)


def _log_to_dict(l: CommunicationLog) -> dict:
    return {
        "id": str(l.id),
        "student_id": str(l.student_id),
        "source": l.source.value,
        "message_type": l.message_type.value,
        "raw_text": l.raw_text,
        "ai_summary": l.ai_summary,
        "zoom_call_date": l.zoom_call_date.isoformat() if l.zoom_call_date else None,
        "zoom_duration_min": l.zoom_duration_min,
        "created_at": l.created_at.isoformat(),
    }


def _insight_to_dict(i: PendingInsight) -> dict:
    return {
        "id": str(i.id),
        "student_id": str(i.student_id),
        "insight_type": i.insight_type.value,
        "proposed_changes": i.proposed_changes,
        "unmatched_fields": i.unmatched_fields,
        "confidence": float(i.confidence),
        "risk_level": i.risk_level.value,
        "status": i.status.value,
        "reviewed_by": str(i.reviewed_by) if i.reviewed_by else None,
        "auto_applied": i.auto_applied,
        "created_at": i.created_at.isoformat(),
        "reviewed_at": i.reviewed_at.isoformat() if i.reviewed_at else None,
    }
