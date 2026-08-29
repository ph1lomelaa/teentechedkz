from __future__ import annotations
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.core.body import optional_date, required_uuid
from app.models.communication_log import CommunicationLog, CommSource, MessageType
from app.models.pending_insight import PendingInsight, InsightStatus
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.telegram_message import TelegramMessage
from app.models.user import User, UserRole
from app.models.mentor_assignment import MentorAssignment
from app.core.audit import log_change
from app.services.mentor_scope import mentor_assigned_student_ids
from app.services.student_notes import (
    apply_student_updates,
    build_insight_note_markdown,
    build_profile_diff,
    snapshot_student,
)

router = APIRouter(prefix="/communications", tags=["communications"])


@router.get("/student/{student_id}")
async def get_logs(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "communication", Action.manage)
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
    require_access(current_user, "communication", Action.manage)
    try:
        source = CommSource(body.get("source", "manual"))
        msg_type = MessageType(body.get("message_type", "text_event"))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    log = CommunicationLog(
        student_id=required_uuid(body, "student_id"),
        source=source,
        message_type=msg_type,
        raw_text=body.get("raw_text"),
        ai_summary=body.get("ai_summary"),
        zoom_call_date=optional_date(body, "zoom_call_date"),
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
    scope: str = "all",
):
    require_access(current_user, "communication", Action.manage)
    query = select(PendingInsight).order_by(PendingInsight.created_at.desc())
    if status:
        try:
            query = query.where(PendingInsight.status == InsightStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")

    result = await db.execute(query)
    insights = result.scalars().all()

    out = []
    for insight in insights:
        responsibles, is_mine = await _student_responsibles(db, insight.student_id, current_user.id)
        if scope == "mine" and not is_mine:
            continue
        student = await db.get(Student, insight.student_id)
        insight_dict = _insight_to_dict(insight)
        insight_dict["student_name"] = student.full_name if student else None
        insight_dict["responsibles"] = responsibles
        insight_dict["is_mine"] = is_mine
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
    require_access(current_user, "communication", Action.manage)
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
    require_access(current_user, "communication", Action.manage)
    result = await db.execute(select(PendingInsight).where(PendingInsight.id == insight_id))
    insight = result.scalar_one_or_none()
    if not insight:
        raise HTTPException(status_code=404, detail="Инсайт не найден")

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
        snapshot = snapshot_student(student)
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
        if insight.unmatched_fields:
            source_text = ""
            if insight.source_telegram_message_id:
                source_message = await db.get(TelegramMessage, insight.source_telegram_message_id)
                source_text = source_message.raw_text if source_message else ""
            db.add(
                StudentNote(
                    student_id=student.id,
                    title="AI-инсайт из Telegram",
                    source_text=source_text or "AI-инсайт без исходного текста",
                    summary_markdown=build_insight_note_markdown(
                        source_text=source_text,
                        snapshot=snapshot,
                        proposed_changes=insight.proposed_changes or {},
                        unmatched_fields=insight.unmatched_fields or {},
                    ),
                    profile_snapshot=snapshot,
                    suggested_changes={},
                    applied_changes={},
                    status=StudentNoteStatus.approved,
                    created_by=current_user.id,
                    reviewed_by=current_user.id,
                    created_at=datetime.now(timezone.utc),
                    reviewed_at=datetime.now(timezone.utc),
                    # Same fix as notes.py "Bug #5" — without this the note is
                    # approved but invisible everywhere (not in the draft queue,
                    # not in the student portal).
                    published_to_student=True,
                    published_at=datetime.now(timezone.utc),
                    published_by=current_user.id,
                )
            )

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


async def _student_responsibles(db: AsyncSession, student_id: uuid.UUID, current_user_id: uuid.UUID) -> tuple[list[dict], bool]:
    result = await db.execute(
        select(MentorAssignment)
        .where(MentorAssignment.student_id == student_id)
    )
    assignments = result.scalars().all()
    responsibles = []
    for a in assignments:
        user = await db.get(User, a.mentor_id)
        responsibles.append({
            "id": str(a.mentor_id),
            "assignment_id": str(a.id),
            "name": user.name if user else None,
            "role": a.role.value,
            "is_active": a.is_active,
        })
    is_mine = any(a.mentor_id == current_user_id and a.is_active for a in assignments)
    return responsibles, is_mine
