"""Книга жалоб и рекомендаций (ОС 30/07, Блок D).

visible_to_role скрывает жалобу от ментора-объекта жалобы по умолчанию
(admin_only) — см. note_visible_to_role, тот же предикат, что у ConfidentialNote.
SLA-цикл (app/services/complaint_sla.py) считает first_response_at по первому
ComplaintReply, не по факту открытия — «увидел» не является ответом (п. 1.3.4).
"""
from __future__ import annotations

import uuid
import re
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.complaint import (
    Complaint, ComplaintReply, ComplaintKind, ComplaintStatus, ComplaintCategory, ApplicantType,
)
from app.models.confidential_note import NoteVisibility, note_visible_to_role
from app.models.student import Student
from app.models.user import User, UserRole
from app.services.mentor_scope import mentor_assigned_student_ids
from app.services.notify import notify, push_notification, dismiss_unread
from app.core.audit import log_change

router = APIRouter(prefix="/complaints", tags=["complaints"])
LEGAL_RISK_RE = re.compile(r"суд|судебн|иск|прокуратур|адвокат|юрист|legal|lawsuit|court", re.IGNORECASE)


def is_legal_risk(subject: str, text: str) -> bool:
    return bool(LEGAL_RISK_RE.search(f"{subject}\n{text}"))


def _complaint_to_dict(c: Complaint, *, include_replies: bool = False, viewer_id: uuid.UUID | None = None) -> dict:
    d = {
        "id": str(c.id),
        "author_user_id": str(c.author_user_id),
        "author_name": c.author.name if c.author else None,
        "student_id": str(c.student_id) if c.student_id else None,
        "student_name": c.student.full_name if getattr(c, "student", None) else None,
        "kind": c.kind.value,
        "applicant_type": c.applicant_type.value,
        "category": c.category.value,
        "subject": c.subject,
        "body": c.body,
        "original_body": c.original_body,
        "intermediate_answer": c.intermediate_answer,
        "final_answer": c.final_answer,
        "decision": c.decision,
        "confirmation": c.confirmation,
        "status": c.status.value,
        "assigned_to": str(c.assigned_to) if c.assigned_to else None,
        "assignee_name": c.assignee.name if c.assignee else None,
        "visible_to_role": c.visible_to_role.value,
        "created_at": c.created_at.isoformat(),
        "first_response_at": c.first_response_at.isoformat() if c.first_response_at else None,
        "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
        "is_sla_breached": c.is_sla_breached,
        "risk_level": c.risk_level,
        "legal_escalated_at": c.legal_escalated_at.isoformat() if c.legal_escalated_at else None,
        "legal_escalation_reason": c.legal_escalation_reason,
    }
    if include_replies:
        d["replies"] = [
            {
                "id": str(r.id),
                "author_user_id": str(r.author_user_id),
                "author_name": r.author.name if r.author else None,
                "body": r.body,
                "created_at": r.created_at.isoformat(),
            }
            for r in c.replies
            if r.visible_to_author or r.author_user_id != c.author_user_id or viewer_id != c.author_user_id
        ]
    return d


def can_view_complaint_rules(
    *, author_user_id, assigned_to, visible_to_role, viewer_id, viewer_role
) -> bool:
    """Pure visibility rule, extracted so it can be unit-tested without a DB.

    The assignee branch is what makes forwarding work at all: complaints are
    admin_only by default, so a mentor who gets one forwarded to them would
    otherwise receive a notification for something they 404 on. Access is
    granted to that one person — not to all mentors — so admin_only keeps
    meaning what it says.
    """
    if author_user_id == viewer_id:
        return True
    if assigned_to is not None and assigned_to == viewer_id:
        return True
    if viewer_role == UserRole.student:
        return False
    return note_visible_to_role(visible_to_role, viewer_role)


async def _can_view_complaint(db: AsyncSession, complaint: Complaint, user: User) -> bool:
    return can_view_complaint_rules(
        author_user_id=complaint.author_user_id,
        assigned_to=complaint.assigned_to,
        visible_to_role=complaint.visible_to_role,
        viewer_id=user.id,
        viewer_role=user.role,
    )


@router.get("")
async def list_complaints(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    status: str | None = Query(default=None),
    kind: str | None = Query(default=None),
    student_id: uuid.UUID | None = Query(default=None),
    sla_breached: bool | None = Query(default=None),
    assigned_to: str | None = Query(default=None, description='UUID или "me"'),
):
    """Список обращений, видимых текущему пользователю — не только персоналу:
    студент/ментор видит свои же обращения (author_user_id), персонал —
    дополнительно всё, что разрешает visible_to_role."""
    from sqlalchemy.orm import selectinload

    query = select(Complaint).options(
        selectinload(Complaint.author), selectinload(Complaint.assignee), selectinload(Complaint.student)
    )

    if current_user.role == UserRole.student:
        query = query.where(Complaint.author_user_id == current_user.id)
    elif current_user.role == UserRole.mentor:
        allowed_ids = await mentor_assigned_student_ids(db, current_user)
        visible_clause = Complaint.visible_to_role == NoteVisibility.all_mentors
        own_clause = Complaint.author_user_id == current_user.id
        # Mirrors can_view_complaint_rules: a forwarded complaint must show up
        # in the assignee's list even when it is admin_only.
        assigned_clause = Complaint.assigned_to == current_user.id
        if allowed_ids is None:
            query = query.where(or_(visible_clause, own_clause, assigned_clause))
        else:
            query = query.where(
                or_(
                    own_clause,
                    assigned_clause,
                    (Complaint.visible_to_role == NoteVisibility.all_mentors)
                    & (Complaint.student_id.in_(allowed_ids) if allowed_ids else False),
                )
            )
    # admin / mzk_manager: no extra clause — note_visible_to_role() lets both through.

    if status:
        try:
            query = query.where(Complaint.status == ComplaintStatus(status))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")
    if kind:
        try:
            query = query.where(Complaint.kind == ComplaintKind(kind))
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный тип обращения")
    if student_id:
        query = query.where(Complaint.student_id == student_id)
    if sla_breached is not None:
        query = query.where(Complaint.is_sla_breached == sla_breached)
    if assigned_to:
        # "me" saves the client from threading its own user id through.
        if assigned_to == "me":
            query = query.where(Complaint.assigned_to == current_user.id)
        else:
            try:
                query = query.where(Complaint.assigned_to == uuid.UUID(assigned_to))
            except ValueError:
                raise HTTPException(status_code=422, detail="Неверный получатель")

    query = query.order_by(Complaint.created_at.desc())
    result = await db.execute(query)
    complaints = result.scalars().all()
    return {"items": [_complaint_to_dict(c) for c in complaints]}


@router.get("/{complaint_id}")
async def get_complaint(
    complaint_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Complaint)
        .options(
            selectinload(Complaint.author),
            selectinload(Complaint.assignee),
            selectinload(Complaint.student),
            selectinload(Complaint.replies).selectinload(ComplaintReply.author),
        )
        .where(Complaint.id == complaint_id)
    )
    complaint = result.scalar_one_or_none()
    if not complaint or not await _can_view_complaint(db, complaint, current_user):
        raise HTTPException(status_code=404, detail="Обращение не найдено")
    return _complaint_to_dict(complaint, include_replies=True, viewer_id=current_user.id)


@router.post("", status_code=201)
async def create_complaint(
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    try:
        kind = ComplaintKind(body.get("kind"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Неверный тип обращения")
    try:
        applicant_type = ApplicantType(body.get("applicant_type", "student"))
        category = ComplaintCategory(body.get("category", "other"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Неверный заявитель или категория")
    subject = (body.get("subject") or "").strip()
    text = (body.get("body") or "").strip()
    if not subject or not text:
        raise HTTPException(status_code=422, detail="Заполните тему и текст обращения")

    student_id = None
    if body.get("student_id"):
        try:
            student_id = uuid.UUID(body["student_id"])
        except (ValueError, TypeError, AttributeError):
            raise HTTPException(status_code=422, detail="Неверный студент")
        if not await db.get(Student, student_id):
            raise HTTPException(status_code=404, detail="Студент не найден")

    complaint = Complaint(
        author_user_id=current_user.id,
        student_id=student_id,
        kind=kind,
        applicant_type=applicant_type,
        category=category,
        subject=subject,
        body=text,
        original_body=text,
        status=ComplaintStatus.new,
        visible_to_role=NoteVisibility.admin_only,
    )
    legal_risk = is_legal_risk(subject, text)
    if legal_risk:
        complaint.risk_level = "high"
        complaint.legal_escalated_at = datetime.now(timezone.utc)
        complaint.legal_escalation_reason = "Обнаружено упоминание суда, иска или юридической претензии"
    db.add(complaint)
    await db.flush()

    managers = await db.execute(
        select(User.id).where(User.role.in_((UserRole.admin, UserRole.mzk_manager)), User.is_active == True)  # noqa: E712
    )
    fresh_notes = []
    for uid in managers.scalars().all():
        fresh_notes.append(notify(
            db, uid,
            kind="complaint_new",
            title=("Юридическая эскалация обращения" if legal_risk else ("Новое обращение" if kind == ComplaintKind.complaint else "Новая рекомендация")),
            body=f"{subject} [complaint:{complaint.id}]",
            link="/workspace/complaints",
            priority="high" if legal_risk or kind == ComplaintKind.complaint else "normal",
        ))

    if legal_risk:
        await log_change(
            db,
            "complaint",
            complaint.id,
            "legal_escalation",
            "normal",
            complaint.legal_escalation_reason,
            str(current_user.id),
            "automatic_risk_detection",
        )

    await db.commit()
    for note in fresh_notes:
        await db.refresh(note)
        await push_notification(note)
    await db.refresh(complaint)
    return _complaint_to_dict(complaint)


@router.patch("/{complaint_id}")
async def update_complaint(
    complaint_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Доступ только для персонала")

    complaint = await db.get(Complaint, complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Обращение не найдено")

    if "status" in body:
        try:
            new_status = ComplaintStatus(body["status"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")
        decision = (body.get("decision") or complaint.decision or "").strip()
        final_answer = (body.get("final_answer") or complaint.final_answer or "").strip()
        confirmation = (body.get("confirmation") or complaint.confirmation or "").strip()
        if new_status == ComplaintStatus.closed and not (decision and final_answer and confirmation):
            raise HTTPException(
                status_code=409,
                detail="Обращение нельзя закрыть без решения, итогового ответа и подтверждения",
                headers={"X-Error-Code": "COMPLAINT_CLOSURE_REQUIREMENTS"},
            )
        complaint.status = new_status
        if new_status in (ComplaintStatus.answered, ComplaintStatus.closed) and not complaint.resolved_at:
            complaint.resolved_at = datetime.now(timezone.utc)

    previous_assignee = complaint.assigned_to
    assignee_changed = False
    if "assigned_to" in body:
        raw = body["assigned_to"]
        if raw:
            try:
                new_assignee_id = uuid.UUID(raw)
            except (ValueError, TypeError, AttributeError):
                raise HTTPException(status_code=422, detail="Неверный получатель")
            target = await db.get(User, new_assignee_id)
            # A student assignee would be notified about something
            # _can_view_complaint still hides from them; an inactive user would
            # simply never see it.
            if not target or not target.is_active or target.role == UserRole.student:
                raise HTTPException(status_code=422, detail="Получателем может быть только активный сотрудник")
            complaint.assigned_to = new_assignee_id
        else:
            complaint.assigned_to = None
        assignee_changed = complaint.assigned_to != previous_assignee

    if "visible_to_role" in body:
        try:
            complaint.visible_to_role = NoteVisibility(body["visible_to_role"])
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверная видимость")
    for field in ("intermediate_answer", "final_answer", "decision", "confirmation"):
        if field in body:
            value = (body[field] or "").strip() or None
            setattr(complaint, field, value)

    note = None
    if assignee_changed:
        if previous_assignee:
            # Otherwise a reassignment leaves a stale "вам передали" bell item
            # pointing at work someone else now owns.
            await dismiss_unread(
                db, previous_assignee, kind="complaint_assigned", body_contains=f"[complaint:{complaint.id}]"
            )
        if complaint.assigned_to and complaint.assigned_to != current_user.id:
            note = notify(
                db,
                complaint.assigned_to,
                kind="complaint_assigned",
                title="Вам передали обращение",
                body=f"{complaint.subject} [complaint:{complaint.id}]",
                link="/workspace/complaints",
                priority="high",
            )

    await db.commit()
    await db.refresh(complaint)
    if note is not None:
        await db.refresh(note)
        await push_notification(note)
    return _complaint_to_dict(complaint)


@router.post("/{complaint_id}/replies", status_code=201)
async def create_reply(
    complaint_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    complaint = await db.get(Complaint, complaint_id)
    if not complaint or not await _can_view_complaint(db, complaint, current_user):
        raise HTTPException(status_code=404, detail="Обращение не найдено")

    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Текст ответа не может быть пустым")

    is_staff_reply = current_user.role in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
    reply = ComplaintReply(
        complaint_id=complaint.id,
        author_user_id=current_user.id,
        body=text,
        visible_to_author=bool(body.get("visible_to_author", True)),
    )
    db.add(reply)

    # Первый содержательный ответ персонала закрывает SLA-часы — «увидел»/
    # «принято, отвечу позже» не в счёт, т.к. это не ComplaintReply.
    if is_staff_reply and current_user.id != complaint.author_user_id and not complaint.first_response_at:
        complaint.first_response_at = datetime.now(timezone.utc)
        if complaint.status == ComplaintStatus.new:
            complaint.status = ComplaintStatus.in_progress

    if is_staff_reply and current_user.id != complaint.author_user_id:
        from app.services.notify import dismiss_unread
        await dismiss_unread(
            db, complaint.author_user_id,
            kind="complaint_sla_warning", body_contains=f"[complaint:{complaint.id}]",
        )
        fresh_note = notify(
            db, complaint.author_user_id,
            kind="complaint_reply",
            title="Ответ на ваше обращение",
            body=f"{complaint.subject} [complaint:{complaint.id}]",
            link="/portal/complaints" if complaint.author.role == UserRole.student else "/workspace/complaints",
            priority="normal",
        )
        await db.commit()
        await db.refresh(fresh_note)
        await push_notification(fresh_note)
    else:
        await db.commit()

    await db.refresh(complaint)
    return _complaint_to_dict(complaint, include_replies=True, viewer_id=current_user.id)
