from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import aliased, selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.models.ai_analysis_run import AiAnalysisRun
from app.models.chat import ConversationMember, Message, MessageAttachment
from app.models.contract import Contract, PipelineStatus
from app.models.document import Document
from app.models.meeting import Meeting, MeetingStatus
from app.models.mentor_assignment import MentorAssignment, MentorRole
from app.models.note_session import NoteSession
from app.models.pending_insight import InsightStatus, PendingInsight
from app.models.questionnaire import Questionnaire, QuestionnaireStatus
from app.core.country_flags_data import flag_for
from app.models.roadmap import Roadmap, RoadmapStatus, RoadmapItemStatus, Stage, RoadmapTask
from app.models.student import Student
from app.models.student_note import StudentNote, StudentNoteStatus
from app.models.student_task import StudentTask, TaskStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_attachment import TelegramAttachment
from app.models.telegram_message import TelegramMessage
from app.models.telegram_participant_identity import TelegramParticipantIdentity
from app.models.user import User, UserRole
from app.models.workspace_message_read import WorkspaceMessageRead
from app.services.mentor_scope import primary_mentor_id, require_student_access
from app.services.student_context_ai import generate_context_review_draft
from app.services.student_notes import apply_student_updates, snapshot_student

router = APIRouter(prefix="/workspace", tags=["workspace"])

STAFF = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)
_FORBIDDEN = HTTPException(status_code=403, detail="Access denied", headers={"X-Error-Code": "FORBIDDEN"})


def _require_staff(user: User) -> None:
    if user.role not in STAFF:
        raise _FORBIDDEN


async def _workspace_student_ids(
    db: AsyncSession,
    user: User,
    mentor_id: uuid.UUID | None = None,
    own_only: bool = False,
) -> list[uuid.UUID] | None:
    """None means unrestricted CRM-like scope; list means personal/preview workspace scope."""
    if mentor_id and user.role == UserRole.mentor and mentor_id != user.id:
        raise _FORBIDDEN
    scoped_mentor_id = user.id if (user.role == UserRole.mentor or own_only) else mentor_id
    if scoped_mentor_id is None:
        return None
    assignment_result = await db.execute(
        select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == scoped_mentor_id,
            MentorAssignment.is_active == True,  # noqa: E712
        )
    )
    student_ids = {row[0] for row in assignment_result.all()}

    contract_result = await db.execute(
        select(Contract.student_id).where(Contract.mzk_manager_id == scoped_mentor_id)
    )
    student_ids.update(row[0] for row in contract_result.all())
    return list(student_ids)


async def _students_for_workspace(
    db: AsyncSession,
    user: User,
    mentor_id: uuid.UUID | None = None,
    own_only: bool = False,
) -> list[Student]:
    student_ids = await _workspace_student_ids(db, user, mentor_id, own_only)
    if student_ids == []:
        return []
    query = select(Student).where(Student.is_archived == False).order_by(Student.full_name)  # noqa: E712
    if student_ids is not None:
        query = query.where(Student.id.in_(student_ids))
    result = await db.execute(query)
    return list(result.scalars().all())


async def _require_workspace_student(
    db: AsyncSession,
    user: User,
    student_id: uuid.UUID,
    mentor_id: uuid.UUID | None = None,
) -> Student:
    scoped_ids = await _workspace_student_ids(db, user, mentor_id)
    if scoped_ids is not None and student_id not in scoped_ids:
        raise HTTPException(status_code=404, detail="Студент не найден")
    student = await db.get(Student, student_id)
    if not student or student.is_archived:
        raise HTTPException(status_code=404, detail="Студент не найден")
    return student


async def _active_roadmap(db: AsyncSession, student_id: uuid.UUID) -> Roadmap | None:
    result = await db.execute(
        select(Roadmap)
        .options(
            selectinload(Roadmap.stages)
            .selectinload(Stage.tasks)
            .selectinload(RoadmapTask.subtasks)
        )
        .where(Roadmap.student_id == student_id, Roadmap.status == RoadmapStatus.active)
        .order_by(Roadmap.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _active_roadmaps_for_students(
    db: AsyncSession,
    student_ids: list[uuid.UUID],
) -> dict[uuid.UUID, Roadmap]:
    if not student_ids:
        return {}
    result = await db.execute(
        select(Roadmap)
        .options(
            selectinload(Roadmap.stages)
            .selectinload(Stage.tasks)
            .selectinload(RoadmapTask.subtasks)
        )
        .where(Roadmap.student_id.in_(student_ids), Roadmap.status == RoadmapStatus.active)
        .order_by(Roadmap.created_at.desc())
    )
    roadmaps: dict[uuid.UUID, Roadmap] = {}
    for roadmap in result.scalars().all():
        roadmaps.setdefault(roadmap.student_id, roadmap)
    return roadmaps


def _roadmap_detail(roadmap: Roadmap | None) -> dict | None:
    if not roadmap:
        return None
    emoji, url = flag_for(roadmap.country_name)
    return {
        "id": str(roadmap.id),
        "student_id": str(roadmap.student_id),
        "mentor_id": str(roadmap.mentor_id) if roadmap.mentor_id else None,
        "template_id": str(roadmap.template_id) if roadmap.template_id else None,
        "name": roadmap.name,
        "country_name": roadmap.country_name,
        "country_flag_emoji": emoji,
        "country_flag_url": url,
        "degree": roadmap.degree,
        "year": roadmap.year,
        "status": roadmap.status.value,
        "created_at": roadmap.created_at.isoformat(),
        "stages": [
            {
                "id": str(stage.id),
                "roadmap_id": str(stage.roadmap_id),
                "name": stage.name,
                "description": stage.description,
                "position": stage.position,
                "status": stage.status.value,
                "tasks": [
                    {
                        "id": str(task.id),
                        "stage_id": str(task.stage_id),
                        "roadmap_id": str(task.roadmap_id),
                        "title": task.title,
                        "description": task.description,
                        "expected_result": task.expected_result,
                        "needs_document": task.needs_document,
                        "needs_zoom": task.needs_zoom,
                        "questionnaire_url": task.questionnaire_url,
                        "priority": task.priority.value,
                        "audience": task.audience.value,
                        "status": task.status.value,
                        "due_date": task.due_date.isoformat() if task.due_date else None,
                        "position": task.position,
                        "subtasks": [
                            {
                                "id": str(subtask.id),
                                "title": subtask.title,
                                "is_done": subtask.is_done,
                                "position": subtask.position,
                            }
                            for subtask in sorted(task.subtasks, key=lambda row: row.position)
                        ],
                    }
                    for task in sorted(stage.tasks, key=lambda row: row.position)
                ],
            }
            for stage in sorted(roadmap.stages, key=lambda row: row.position)
        ],
    }


def _roadmap_summary(roadmap: Roadmap | None) -> dict:
    if not roadmap:
        return {
            "id": None,
            "name": None,
            "country_name": None,
            "country_flag_emoji": "",
            "country_flag_url": "",
            "year": None,
            "tasks_total": 0,
            "tasks_done": 0,
            "progress": 0,
        }
    tasks = [task for stage in roadmap.stages for task in stage.tasks]
    done = len([task for task in tasks if task.status == RoadmapItemStatus.done])
    total = len(tasks)
    emoji, url = flag_for(roadmap.country_name)
    return {
        "id": str(roadmap.id),
        "name": roadmap.name,
        "country_name": roadmap.country_name,
        "country_flag_emoji": emoji,
        "country_flag_url": url,
        "year": roadmap.year,
        "tasks_total": total,
        "tasks_done": done,
        "progress": round((done / total) * 100) if total else 0,
    }


def _paginate_unified_items(items: list[dict], offset: int, limit: int) -> tuple[list[dict], bool]:
    items.sort(key=lambda item: (item["created_at"], item["id"]), reverse=True)
    has_more = len(items) > offset + limit
    return list(reversed(items[offset:offset + limit])), has_more


async def _count(db: AsyncSession, stmt) -> int:
    result = await db.execute(stmt)
    return int(result.scalar() or 0)


async def _next_meeting(db: AsyncSession, student_id: uuid.UUID) -> dict | None:
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(Meeting)
        .where(
            Meeting.student_id == student_id,
            Meeting.status == MeetingStatus.scheduled,
            Meeting.ends_at >= now,
        )
        .order_by(Meeting.starts_at.asc())
        .limit(1)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        return None
    return {
        "id": str(meeting.id),
        "title": meeting.title,
        "starts_at": meeting.starts_at.isoformat(),
        "meeting_link": meeting.meeting_link,
    }


async def _primary_mentor(db: AsyncSession, student_id: uuid.UUID) -> dict | None:
    mentor_id = await primary_mentor_id(db, student_id)
    if not mentor_id:
        return None
    mentor = await db.get(User, mentor_id)
    if not mentor:
        return None
    return {"id": str(mentor.id), "name": mentor.name}


async def _student_brief(db: AsyncSession, student: Student) -> dict:
    portal_user = await db.get(User, student.user_id) if student.user_id else None
    return {
        "id": str(student.id),
        "full_name": student.full_name,
        "phone": student.phone,
        "degree_level": student.degree_level.value,
        "intake_year": student.intake_year,
        "city": student.city,
        "has_portal_access": bool(student.user_id),
        "portal_email": portal_user.email if portal_user else None,
    }


async def _student_briefs(db: AsyncSession, students: list[Student]) -> dict[uuid.UUID, dict]:
    user_ids = [student.user_id for student in students if student.user_id]
    users: dict[uuid.UUID, User] = {}
    if user_ids:
        result = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = {user.id: user for user in result.scalars().all()}
    return {
        student.id: {
            "id": str(student.id),
            "full_name": student.full_name,
            "phone": student.phone,
            "degree_level": student.degree_level.value,
            "intake_year": student.intake_year,
            "city": student.city,
            "has_portal_access": bool(student.user_id),
            "portal_email": users[student.user_id].email if student.user_id in users else None,
        }
        for student in students
    }


async def _primary_mentors_for_students(
    db: AsyncSession,
    student_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict]:
    if not student_ids:
        return {}
    result = await db.execute(
        select(MentorAssignment, User)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id.in_(student_ids),
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(MentorAssignment.assigned_at.desc())
    )
    fallback: dict[uuid.UUID, User] = {}
    leads: dict[uuid.UUID, User] = {}
    for assignment, mentor in result.all():
        fallback.setdefault(assignment.student_id, mentor)
        if assignment.role == MentorRole.lead:
            leads.setdefault(assignment.student_id, mentor)
    return {
        student_id: {"id": str(mentor.id), "name": mentor.name}
        for student_id in student_ids
        if (mentor := leads.get(student_id) or fallback.get(student_id))
    }


async def _student_summary(db: AsyncSession, student: Student) -> dict:
    roadmap = await _active_roadmap(db, student.id)
    mentor = await _primary_mentor(db, student.id)
    open_tasks = await _count(
        db,
        select(func.count()).select_from(StudentTask).where(
            StudentTask.student_id == student.id,
            StudentTask.status == TaskStatus.open,
        ),
    )
    document_count = await _count(
        db,
        select(func.count()).select_from(Document).where(Document.student_id == student.id),
    )
    documents_unverified = await _count(
        db,
        select(func.count()).select_from(Document).where(
            Document.student_id == student.id,
            Document.is_verified == False,  # noqa: E712
        ),
    )
    telegram_linked = await _count(
        db,
        select(func.count()).select_from(TelegramChatSession).where(
            TelegramChatSession.student_id == student.id,
            TelegramChatSession.status == TelegramSessionStatus.active,
        ),
    )
    telegram_signals = await _count(
        db,
        select(func.count()).select_from(PendingInsight).where(
            PendingInsight.student_id == student.id,
            PendingInsight.status == InsightStatus.pending,
            PendingInsight.source_telegram_message_id.is_not(None),
        ),
    )
    note_sessions = await _count(
        db,
        select(func.count()).select_from(NoteSession).where(NoteSession.student_id == student.id),
    )
    ai_drafts = await _count(
        db,
        select(func.count()).select_from(StudentNote).where(
            StudentNote.student_id == student.id,
            StudentNote.status == StudentNoteStatus.draft,
        ),
    )
    next_meeting = await _next_meeting(db, student.id)
    roadmap_summary = _roadmap_summary(roadmap)
    warnings = []
    if not student.user_id:
        warnings.append("portal_access_missing")
    if not mentor:
        warnings.append("primary_mentor_missing")
    if not roadmap:
        warnings.append("roadmap_missing")
    if not telegram_linked:
        warnings.append("telegram_missing")
    if not next_meeting:
        warnings.append("next_meeting_missing")
    return {
        "student": await _student_brief(db, student),
        "primary_mentor": mentor,
        "roadmap": roadmap_summary,
        "open_roadmap_tasks": max(
            roadmap_summary["tasks_total"] - roadmap_summary["tasks_done"],
            0,
        ),
        "open_internal_tasks": open_tasks,
        "next_meeting": next_meeting,
        "documents": {
            "total": document_count,
            "unverified": documents_unverified,
        },
        "telegram": {
            "linked": bool(telegram_linked),
            "pending_signals": telegram_signals,
        },
        "notes": {
            "sessions": note_sessions,
            "ai_drafts": ai_drafts,
        },
        "warnings": warnings,
    }


async def _student_summaries(db: AsyncSession, students: list[Student]) -> list[dict]:
    """Build the workspace list in a fixed number of queries instead of per-student N+1 queries."""
    if not students:
        return []
    student_ids = [student.id for student in students]

    portal_user_ids = [student.user_id for student in students if student.user_id]
    portal_users: dict[uuid.UUID, User] = {}
    if portal_user_ids:
        users_result = await db.execute(select(User).where(User.id.in_(portal_user_ids)))
        portal_users = {user.id: user for user in users_result.scalars().all()}

    roadmaps_result = await db.execute(
        select(Roadmap)
        .options(
            selectinload(Roadmap.stages)
            .selectinload(Stage.tasks)
            .selectinload(RoadmapTask.subtasks)
        )
        .where(Roadmap.student_id.in_(student_ids), Roadmap.status == RoadmapStatus.active)
        .order_by(Roadmap.created_at.desc())
    )
    roadmaps: dict[uuid.UUID, Roadmap] = {}
    for roadmap in roadmaps_result.scalars().all():
        roadmaps.setdefault(roadmap.student_id, roadmap)

    assignments_result = await db.execute(
        select(MentorAssignment, User)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id.in_(student_ids),
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(MentorAssignment.assigned_at.desc())
    )
    fallback_mentors: dict[uuid.UUID, User] = {}
    lead_mentors: dict[uuid.UUID, User] = {}
    for assignment, mentor in assignments_result.all():
        fallback_mentors.setdefault(assignment.student_id, mentor)
        if assignment.role == MentorRole.lead:
            lead_mentors.setdefault(assignment.student_id, mentor)

    async def grouped_counts(stmt) -> dict[uuid.UUID, int]:
        result = await db.execute(stmt)
        return {student_id: int(count or 0) for student_id, count in result.all()}

    open_tasks = await grouped_counts(
        select(StudentTask.student_id, func.count(StudentTask.id))
        .where(StudentTask.student_id.in_(student_ids), StudentTask.status == TaskStatus.open)
        .group_by(StudentTask.student_id)
    )
    document_result = await db.execute(
        select(
            Document.student_id,
            func.count(Document.id),
            func.count(Document.id).filter(Document.is_verified == False),  # noqa: E712
        )
        .where(Document.student_id.in_(student_ids))
        .group_by(Document.student_id)
    )
    document_counts = {
        student_id: (int(total or 0), int(unverified or 0))
        for student_id, total, unverified in document_result.all()
    }
    telegram_linked = await grouped_counts(
        select(TelegramChatSession.student_id, func.count(TelegramChatSession.id))
        .where(
            TelegramChatSession.student_id.in_(student_ids),
            TelegramChatSession.status == TelegramSessionStatus.active,
        )
        .group_by(TelegramChatSession.student_id)
    )
    telegram_signals = await grouped_counts(
        select(PendingInsight.student_id, func.count(PendingInsight.id))
        .where(
            PendingInsight.student_id.in_(student_ids),
            PendingInsight.status == InsightStatus.pending,
            PendingInsight.source_telegram_message_id.is_not(None),
        )
        .group_by(PendingInsight.student_id)
    )
    note_sessions = await grouped_counts(
        select(NoteSession.student_id, func.count(NoteSession.id))
        .where(NoteSession.student_id.in_(student_ids))
        .group_by(NoteSession.student_id)
    )
    ai_drafts = await grouped_counts(
        select(StudentNote.student_id, func.count(StudentNote.id))
        .where(
            StudentNote.student_id.in_(student_ids),
            StudentNote.status == StudentNoteStatus.draft,
        )
        .group_by(StudentNote.student_id)
    )

    now = datetime.now(timezone.utc)
    meetings_result = await db.execute(
        select(Meeting)
        .where(
            Meeting.student_id.in_(student_ids),
            Meeting.status == MeetingStatus.scheduled,
            Meeting.ends_at >= now,
        )
        .order_by(Meeting.starts_at.asc())
    )
    next_meetings: dict[uuid.UUID, Meeting] = {}
    for meeting in meetings_result.scalars().all():
        next_meetings.setdefault(meeting.student_id, meeting)

    summaries: list[dict] = []
    for student in students:
        roadmap = roadmaps.get(student.id)
        roadmap_summary = _roadmap_summary(roadmap)
        mentor = lead_mentors.get(student.id) or fallback_mentors.get(student.id)
        meeting = next_meetings.get(student.id)
        linked_count = telegram_linked.get(student.id, 0)
        warnings = []
        if not student.user_id:
            warnings.append("portal_access_missing")
        if not mentor:
            warnings.append("primary_mentor_missing")
        if not roadmap:
            warnings.append("roadmap_missing")
        if not linked_count:
            warnings.append("telegram_missing")
        if not meeting:
            warnings.append("next_meeting_missing")
        portal_user = portal_users.get(student.user_id) if student.user_id else None
        total_documents, unverified_documents = document_counts.get(student.id, (0, 0))
        summaries.append({
            "student": {
                "id": str(student.id),
                "full_name": student.full_name,
                "phone": student.phone,
                "degree_level": student.degree_level.value,
                "intake_year": student.intake_year,
                "city": student.city,
                "has_portal_access": bool(student.user_id),
                "portal_email": portal_user.email if portal_user else None,
            },
            "primary_mentor": {"id": str(mentor.id), "name": mentor.name} if mentor else None,
            "roadmap": roadmap_summary,
            "open_roadmap_tasks": max(roadmap_summary["tasks_total"] - roadmap_summary["tasks_done"], 0),
            "open_internal_tasks": open_tasks.get(student.id, 0),
            "next_meeting": {
                "id": str(meeting.id),
                "title": meeting.title,
                "starts_at": meeting.starts_at.isoformat(),
                "meeting_link": meeting.meeting_link,
            } if meeting else None,
            "documents": {"total": total_documents, "unverified": unverified_documents},
            "telegram": {"linked": bool(linked_count), "pending_signals": telegram_signals.get(student.id, 0)},
            "notes": {"sessions": note_sessions.get(student.id, 0), "ai_drafts": ai_drafts.get(student.id, 0)},
            "warnings": warnings,
        })
    return summaries


async def _workspace_workload(db: AsyncSession, student_ids: list[uuid.UUID], summaries: list[dict]) -> list[dict]:
    if not student_ids:
        return []
    summary_by_student = {uuid.UUID(item["student"]["id"]): item for item in summaries}
    result = await db.execute(
        select(MentorAssignment, User)
        .join(User, User.id == MentorAssignment.mentor_id)
        .where(
            MentorAssignment.student_id.in_(student_ids),
            MentorAssignment.is_active == True,  # noqa: E712
        )
        .order_by(User.name.asc(), MentorAssignment.role.asc())
    )

    grouped: dict[uuid.UUID, dict] = {}
    for assignment, mentor in result.all():
        item = grouped.setdefault(
            assignment.mentor_id,
            {
                "mentor": {"id": str(mentor.id), "name": mentor.name, "role": mentor.role.value},
                "students": set(),
                "roles": set(),
                "open_tasks": 0,
                "upcoming_meetings": 0,
                "telegram_signals": 0,
                "documents_unverified": 0,
                "ai_drafts": 0,
                "health_warnings": 0,
            },
        )
        item["students"].add(assignment.student_id)
        item["roles"].add(assignment.role.value)

    for item in grouped.values():
        for student_id in item["students"]:
            summary = summary_by_student.get(student_id)
            if not summary:
                continue
            item["open_tasks"] += summary["open_internal_tasks"]
            item["upcoming_meetings"] += 1 if summary["next_meeting"] else 0
            item["telegram_signals"] += summary["telegram"]["pending_signals"]
            item["documents_unverified"] += summary["documents"]["unverified"]
            item["ai_drafts"] += summary["notes"]["ai_drafts"]
            item["health_warnings"] += len(summary["warnings"])

    out = []
    for item in grouped.values():
        students_count = len(item["students"])
        out.append(
            {
                "mentor": item["mentor"],
                "students_total": students_count,
                "roles": sorted(item["roles"]),
                "open_tasks": item["open_tasks"],
                "upcoming_meetings": item["upcoming_meetings"],
                "telegram_signals": item["telegram_signals"],
                "documents_unverified": item["documents_unverified"],
                "ai_drafts": item["ai_drafts"],
                "health_warnings": item["health_warnings"],
                "load_score": (
                    students_count
                    + item["open_tasks"] * 0.5
                    + item["telegram_signals"]
                    + item["documents_unverified"] * 0.75
                    + item["ai_drafts"] * 0.75
                ),
            }
        )
    out.sort(key=lambda row: row["load_score"], reverse=True)
    return out


def _workspace_health_signals(summaries: list[dict], attention: list[dict]) -> list[dict]:
    def count_attention(kind: str) -> int:
        return len([item for item in attention if item["kind"] == kind])

    total_open_tasks = sum(item["open_internal_tasks"] for item in summaries)
    total_telegram_signals = sum(item["telegram"]["pending_signals"] for item in summaries)
    total_docs_unverified = sum(item["documents"]["unverified"] for item in summaries)
    total_ai_drafts = sum(item["notes"]["ai_drafts"] for item in summaries)

    signals = [
        {
            "kind": "no_next_meeting",
            "label": "Студенты без ближайшей встречи",
            "count": count_attention("next_meeting_missing"),
            "severity": "medium",
        },
        {
            "kind": "missing_roadmap",
            "label": "Roadmap не назначен",
            "count": count_attention("roadmap_missing"),
            "severity": "high",
        },
        {
            "kind": "telegram_unlinked",
            "label": "Telegram не привязан",
            "count": count_attention("telegram_missing"),
            "severity": "medium",
        },
        {
            "kind": "open_tasks",
            "label": "Открытые задачи",
            "count": total_open_tasks,
            "severity": "medium",
        },
        {
            "kind": "telegram_signals",
            "label": "Telegram-сигналы на ревью",
            "count": total_telegram_signals,
            "severity": "high",
        },
        {
            "kind": "documents_review",
            "label": "Документы на проверку",
            "count": total_docs_unverified,
            "severity": "high",
        },
        {
            "kind": "ai_drafts",
            "label": "AI-черновики notes",
            "count": total_ai_drafts,
            "severity": "medium",
        },
        {
            "kind": "low_roadmap_progress",
            "label": "Низкий прогресс roadmap",
            "count": count_attention("low_roadmap_progress"),
            "severity": "low",
        },
    ]
    return [signal for signal in signals if signal["count"] > 0]


@router.get("/dashboard")
async def workspace_dashboard(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    _require_staff(current_user)
    students = await _students_for_workspace(db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None))
    summaries = await _student_summaries(db, students)
    student_ids = [student.id for student in students]
    active_work = 0
    if student_ids:
        active_work = await _count(
            db,
            select(func.count(func.distinct(Contract.student_id))).where(
                Contract.student_id.in_(student_ids),
                Contract.pipeline_status == PipelineStatus.active_work,
            ),
        )
    upcoming_meetings = [
        {"student": item["student"], "meeting": item["next_meeting"]}
        for item in summaries
        if item["next_meeting"]
    ]
    upcoming_meetings.sort(key=lambda row: row["meeting"]["starts_at"])
    attention = []
    for item in summaries:
        student = item["student"]
        for warning in item["warnings"]:
            attention.append({"student": student, "kind": warning})
        if item["open_internal_tasks"] > 0:
            attention.append({"student": student, "kind": "open_internal_tasks", "count": item["open_internal_tasks"]})
        if item["telegram"]["pending_signals"] > 0:
            attention.append({"student": student, "kind": "telegram_signals", "count": item["telegram"]["pending_signals"]})
        if item["roadmap"]["id"] and item["roadmap"]["progress"] < 35:
            attention.append({"student": student, "kind": "low_roadmap_progress", "progress": item["roadmap"]["progress"]})
    workload = await _workspace_workload(db, student_ids, summaries)
    health_signals = _workspace_health_signals(summaries, attention)
    return {
        "stats": {
            "students_total": len(summaries),
            "active_work": active_work,
            "open_roadmap_tasks": sum(item["open_roadmap_tasks"] for item in summaries),
            "open_internal_tasks": sum(item["open_internal_tasks"] for item in summaries),
            "upcoming_meetings": len(upcoming_meetings),
            "without_roadmap": len([item for item in summaries if not item["roadmap"]["id"]]),
            "telegram_signals": sum(item["telegram"]["pending_signals"] for item in summaries),
            "documents_total": sum(item["documents"]["total"] for item in summaries),
            "documents_unverified": sum(item["documents"]["unverified"] for item in summaries),
            "ai_drafts": sum(item["notes"]["ai_drafts"] for item in summaries),
        },
        "students": summaries,
        "upcoming_meetings": upcoming_meetings[:10],
        "attention": attention[:20],
        "workload": workload,
        "health_signals": health_signals,
    }


@router.get("/students")
async def workspace_students(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    _require_staff(current_user)
    students = await _students_for_workspace(db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None))
    return {
        "items": await _student_summaries(db, students),
        "total": len(students),
    }


@router.get("/roadmap")
async def workspace_roadmap(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    _require_staff(current_user)
    students = await _students_for_workspace(db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None))
    student_ids = [student.id for student in students]
    roadmaps = await _active_roadmaps_for_students(db, student_ids)
    mentors = await _primary_mentors_for_students(db, student_ids)
    briefs = await _student_briefs(db, students)
    items = []
    for student in students:
        roadmap = roadmaps.get(student.id)
        items.append(
            {
                "student": briefs[student.id],
                "primary_mentor": mentors.get(student.id),
                "roadmap": _roadmap_summary(roadmap),
                "warnings": [] if roadmap else ["roadmap_missing"],
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/roadmaps/full")
async def workspace_full_roadmaps(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    """Full active roadmaps for the mentor workspace in one scoped request."""
    _require_staff(current_user)
    students = await _students_for_workspace(
        db,
        current_user,
        mentor_id,
        own_only=(scope == "mine" and mentor_id is None),
    )
    student_ids = [student.id for student in students]
    roadmaps = await _active_roadmaps_for_students(db, student_ids)
    briefs = await _student_briefs(db, students)
    items = []
    for student in students:
        items.append(
            {
                "student": briefs[student.id],
                "roadmap": _roadmap_detail(roadmaps.get(student.id)),
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/roadmap-tasks")
async def workspace_roadmap_tasks(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
    status: str | None = Query(default=None, pattern="^(open|done)$"),
):
    """Flattened live roadmap tasks across the caller's workspace scope.

    Powers the unified "Задачи" feed so the mentor sees the actual student-facing
    roadmap work in one place — not only the internal StudentTask list.
    """
    _require_staff(current_user)
    students = await _students_for_workspace(
        db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None)
    )
    name_by_id = {student.id: student.full_name for student in students}
    student_ids = [student.id for student in students]
    if not student_ids:
        return {"items": [], "total": 0}

    result = await db.execute(
        select(Roadmap)
        .options(
            selectinload(Roadmap.stages)
            .selectinload(Stage.tasks)
            .selectinload(RoadmapTask.subtasks)
        )
        .where(Roadmap.student_id.in_(student_ids), Roadmap.status == RoadmapStatus.active)
        .order_by(Roadmap.created_at.desc())
    )
    seen: set[uuid.UUID] = set()
    items: list[dict] = []
    for roadmap in result.scalars().all():
        if roadmap.student_id in seen:
            continue  # keep only the latest active roadmap per student
        seen.add(roadmap.student_id)
        for stage in roadmap.stages:
            for task in stage.tasks:
                is_done = task.status == RoadmapItemStatus.done
                if status == "open" and is_done:
                    continue
                if status == "done" and not is_done:
                    continue
                items.append(
                    {
                        "id": str(task.id),
                        "student_id": str(roadmap.student_id),
                        "student_name": name_by_id.get(roadmap.student_id, "Студент"),
                        "roadmap_id": str(roadmap.id),
                        "stage_name": stage.name,
                        "stage_position": stage.position,
                        "title": task.title,
                        "status": task.status.value,
                        "priority": task.priority.value,
                        "audience": task.audience.value,
                        "due_date": task.due_date.isoformat() if task.due_date else None,
                        "needs_document": task.needs_document,
                        "needs_zoom": task.needs_zoom,
                        "has_questionnaire": bool(task.questionnaire_url),
                        "questionnaire_url": task.questionnaire_url,
                        "subtasks_total": len(task.subtasks),
                        "subtasks_done": len([st for st in task.subtasks if st.is_done]),
                        "position": task.position,
                    }
                )
    items.sort(key=lambda it: (it["status"] == "done", it["due_date"] or "9999-12-31", it["student_name"]))
    return {"items": items, "total": len(items)}


@router.get("/questionnaires")
async def workspace_questionnaires(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
    status: str | None = Query(default=None, pattern="^(draft|sent|submitted|reviewed)$"),
):
    """Aggregated questionnaire tracker across the caller's workspace scope.

    Lets a mentor/manager see every native questionnaire (draft/sent/submitted/
    reviewed) across their assigned students in one place, instead of having to
    open each roadmap task individually to check its status.
    """
    _require_staff(current_user)
    students = await _students_for_workspace(
        db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None)
    )
    name_by_id = {student.id: student.full_name for student in students}
    student_ids = [student.id for student in students]
    if not student_ids:
        return {"items": [], "total": 0}

    stmt = (
        select(Questionnaire)
        .options(selectinload(Questionnaire.questions), selectinload(Questionnaire.response))
        .where(Questionnaire.student_id.in_(student_ids))
        .order_by(Questionnaire.created_at.desc())
    )
    if status:
        stmt = stmt.where(Questionnaire.status == QuestionnaireStatus(status))
    result = await db.execute(stmt)
    items = [
        {
            "id": str(q.id),
            "roadmap_task_id": str(q.roadmap_task_id) if q.roadmap_task_id else None,
            "student_id": str(q.student_id),
            "student_name": name_by_id.get(q.student_id, "Студент"),
            "title": q.title,
            "status": q.status.value,
            "question_count": len(q.questions),
            "has_response": q.response is not None,
            "created_at": q.created_at.isoformat(),
            "sent_at": q.sent_at.isoformat() if q.sent_at else None,
            "submitted_at": q.submitted_at.isoformat() if q.submitted_at else None,
            "reviewed_at": q.reviewed_at.isoformat() if q.reviewed_at else None,
        }
        for q in result.scalars().all()
    ]
    return {"items": items, "total": len(items)}


@router.get("/meetings")
async def workspace_meetings(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    _require_staff(current_user)
    students = await _students_for_workspace(db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None))
    student_ids = [student.id for student in students]
    if not student_ids:
        return {"items": [], "total": 0}

    result = await db.execute(
        select(Meeting, Student.full_name, NoteSession.id)
        .join(Student, Student.id == Meeting.student_id)
        .outerjoin(NoteSession, NoteSession.meeting_id == Meeting.id)
        .where(Meeting.student_id.in_(student_ids), Student.is_archived == False)  # noqa: E712
        .order_by(Meeting.starts_at.asc())
    )
    items = []
    for meeting, student_name, note_session_id in result.all():
        items.append(
            {
                "id": str(meeting.id),
                "student_id": str(meeting.student_id),
                "student_name": student_name,
                "mentor_id": str(meeting.mentor_id) if meeting.mentor_id else None,
                "title": meeting.title,
                "meeting_type": meeting.meeting_type.value,
                "description": meeting.description,
                "outcome": meeting.outcome,
                "starts_at": meeting.starts_at.isoformat(),
                "ends_at": meeting.ends_at.isoformat(),
                "meeting_link": meeting.meeting_link,
                "recording_url": meeting.recording_url,
                "transcript_url": meeting.transcript_url,
                "status": meeting.status.value,
                "note_session_id": str(note_session_id) if note_session_id else None,
                "created_at": meeting.created_at.isoformat(),
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/documents")
async def workspace_documents(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    _require_staff(current_user)
    students = await _students_for_workspace(db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None))
    student_ids = [student.id for student in students]
    if not student_ids:
        return {"items": [], "total": 0}

    result = await db.execute(
        select(Document, Student.full_name)
        .join(Student, Student.id == Document.student_id)
        .where(Document.student_id.in_(student_ids), Student.is_archived == False)  # noqa: E712
        .order_by(Document.uploaded_at.desc())
    )
    rows = result.all()
    document_ids = [document.id for document, _student_name in rows]
    source_messages: dict[uuid.UUID, dict] = {}
    if document_ids:
        internal_sources = await db.execute(
            select(
                MessageAttachment.document_id,
                MessageAttachment.message_id,
                Message.conversation_id,
            )
            .join(Message, Message.id == MessageAttachment.message_id)
            .where(MessageAttachment.document_id.in_(document_ids))
        )
        for document_id, message_id, conversation_id in internal_sources.all():
            source_messages[document_id] = {
                "channel": "internal",
                "message_id": str(message_id),
                "chat_id": str(conversation_id),
            }
        telegram_sources = await db.execute(
            select(Document.id, TelegramAttachment.message_id, TelegramMessage.chat_id)
            .join(
                TelegramAttachment,
                TelegramAttachment.id == Document.source_telegram_attachment_id,
            )
            .join(TelegramMessage, TelegramMessage.id == TelegramAttachment.message_id)
            .where(Document.id.in_(document_ids))
        )
        for document_id, message_id, chat_id in telegram_sources.all():
            source_messages[document_id] = {
                "channel": "telegram",
                "message_id": str(message_id),
                "chat_id": str(chat_id),
            }

    items = []
    for document, student_name in rows:
        items.append(
            {
                "id": str(document.id),
                "student_id": str(document.student_id),
                "student_name": student_name,
                "doc_type": document.doc_type.value,
                "file_name": document.file_name,
                "file_size": document.file_size,
                "mime_type": document.mime_type,
                "source": document.source.value,
                "ai_description": document.ai_description,
                "is_verified": document.is_verified,
                "visible_to_student": document.visible_to_student,
                "source_message": source_messages.get(document.id),
                "uploaded_at": document.uploaded_at.isoformat(),
            }
        )
    return {"items": items, "total": len(items)}


@router.get("/notes")
async def workspace_notes(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    scope: str = Query(default="all", pattern="^(all|mine)$"),
):
    _require_staff(current_user)
    students = await _students_for_workspace(db, current_user, mentor_id, own_only=(scope == "mine" and mentor_id is None))
    student_ids = [student.id for student in students]
    if not student_ids:
        return {"sessions": [], "notes": [], "total_sessions": 0, "total_notes": 0}

    sessions_result = await db.execute(
        select(NoteSession, Student.full_name)
        .options(selectinload(NoteSession.transcripts))
        .join(Student, Student.id == NoteSession.student_id)
        .where(NoteSession.student_id.in_(student_ids), Student.is_archived == False)  # noqa: E712
        .order_by(NoteSession.started_at.desc())
    )
    sessions = []
    for session, student_name in sessions_result.all():
        latest_transcript = session.transcripts[-1].text if session.transcripts else session.backup_transcript_text
        sessions.append(
            {
                "id": str(session.id),
                "student_id": str(session.student_id) if session.student_id else None,
                "student_name": student_name,
                "note_id": str(session.note_id) if session.note_id else None,
                "meeting_id": str(session.meeting_id) if session.meeting_id else None,
                "title": session.title,
                "source": session.source,
                "status": session.status.value,
                "started_at": session.started_at.isoformat(),
                "ended_at": session.ended_at.isoformat() if session.ended_at else None,
                "last_heartbeat_at": session.last_heartbeat_at.isoformat() if session.last_heartbeat_at else None,
                "created_by": str(session.created_by) if session.created_by else None,
                "transcript_count": len(session.transcripts),
                "latest_transcript": latest_transcript,
            }
        )

    notes_result = await db.execute(
        select(StudentNote, Student.full_name)
        .join(Student, Student.id == StudentNote.student_id)
        .where(StudentNote.student_id.in_(student_ids), Student.is_archived == False)  # noqa: E712
        .order_by(StudentNote.created_at.desc())
    )
    notes = []
    for note, student_name in notes_result.all():
        notes.append(
            {
                "id": str(note.id),
                "student_id": str(note.student_id) if note.student_id else None,
                "student_name": student_name,
                "title": note.title,
                "source_text": note.source_text,
                "summary_markdown": note.summary_markdown,
                "profile_snapshot": note.profile_snapshot,
                "suggested_changes": note.suggested_changes,
                "applied_changes": note.applied_changes,
                "status": note.status.value,
                "created_by": str(note.created_by) if note.created_by else None,
                "reviewed_by": str(note.reviewed_by) if note.reviewed_by else None,
                "created_at": note.created_at.isoformat(),
                "reviewed_at": note.reviewed_at.isoformat() if note.reviewed_at else None,
            }
        )
    return {
        "sessions": sessions,
        "notes": notes,
        "total_sessions": len(sessions),
        "total_notes": len(notes),
    }


@router.get("/message-unread")
async def workspace_message_unread(
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
):
    _require_staff(current_user)
    if mentor_id and current_user.role in (UserRole.admin, UserRole.mzk_manager):
        mentor = await db.get(User, mentor_id)
        if not mentor or mentor.role != UserRole.mentor:
            raise HTTPException(status_code=404, detail="Ментор не найден")
    students = await _students_for_workspace(db, current_user, mentor_id)
    perspective_user_id = mentor_id or current_user.id
    if not students:
        return {"items": {}}
    student_ids = [student.id for student in students]

    student_membership = aliased(ConversationMember)
    staff_membership = aliased(ConversationMember)
    internal_result = await db.execute(
        select(Student.id, func.count(Message.id))
        .join(student_membership, student_membership.user_id == Student.user_id)
        .join(
            staff_membership,
            and_(
                staff_membership.conversation_id == student_membership.conversation_id,
                staff_membership.user_id == perspective_user_id,
            ),
        )
        .join(Message, Message.conversation_id == student_membership.conversation_id)
        .where(
            Student.id.in_(student_ids),
            Message.sender_id != perspective_user_id,
            Message.created_at > staff_membership.last_read_at,
        )
        .group_by(Student.id)
    )
    internal_counts = {student_id: int(count or 0) for student_id, count in internal_result.all()}

    read_result = await db.execute(
        select(WorkspaceMessageRead.student_id).where(
            WorkspaceMessageRead.user_id == perspective_user_id,
            WorkspaceMessageRead.student_id.in_(student_ids),
        )
    )
    existing_read_ids = {row[0] for row in read_result.all()}
    missing_read_ids = [student_id for student_id in student_ids if student_id not in existing_read_ids]
    if missing_read_ids:
        read_at = datetime.now(timezone.utc)
        await db.execute(
            pg_insert(WorkspaceMessageRead)
            .values([
                {
                    "user_id": perspective_user_id,
                    "student_id": student_id,
                    "telegram_last_read_at": read_at,
                }
                for student_id in missing_read_ids
            ])
            .on_conflict_do_nothing(
                index_elements=[WorkspaceMessageRead.user_id, WorkspaceMessageRead.student_id]
            )
        )

    telegram_result = await db.execute(
        select(TelegramChatSession.student_id, func.count(TelegramMessage.id))
        .join(TelegramMessage, TelegramMessage.session_id == TelegramChatSession.id)
        .join(
            WorkspaceMessageRead,
            and_(
                WorkspaceMessageRead.student_id == TelegramChatSession.student_id,
                WorkspaceMessageRead.user_id == perspective_user_id,
            ),
        )
        .where(
            TelegramChatSession.student_id.in_(student_ids),
            TelegramMessage.created_at > WorkspaceMessageRead.telegram_last_read_at,
            or_(
                TelegramMessage.sent_by_user_id.is_(None),
                TelegramMessage.sent_by_user_id != perspective_user_id,
            ),
        )
        .group_by(TelegramChatSession.student_id)
    )
    telegram_counts = {student_id: int(count or 0) for student_id, count in telegram_result.all()}
    result: dict[str, dict[str, int]] = {}
    for student_id in student_ids:
        internal_unread = internal_counts.get(student_id, 0)
        telegram_unread = telegram_counts.get(student_id, 0)
        result[str(student_id)] = {
            "internal": internal_unread,
            "telegram": telegram_unread,
            "total": internal_unread + telegram_unread,
        }
    if missing_read_ids:
        await db.commit()
    return {"items": result}


@router.post("/students/{student_id}/messages/read", status_code=204)
async def mark_workspace_messages_read(
    student_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_staff(current_user)
    student = await _require_workspace_student(db, current_user, student_id)
    channel = str(body.get("channel") or "all")
    if channel not in {"all", "internal", "telegram"}:
        raise HTTPException(status_code=422, detail="Неверный канал")
    now = datetime.now(timezone.utc)
    if channel in {"all", "internal"} and student.user_id:
        conversation_result = await db.execute(
            select(ConversationMember.conversation_id).where(
                ConversationMember.user_id == student.user_id
            )
        )
        conversation_ids = [row[0] for row in conversation_result.all()]
        if conversation_ids:
            await db.execute(
                ConversationMember.__table__.update()
                .where(
                    ConversationMember.conversation_id.in_(conversation_ids),
                    ConversationMember.user_id == current_user.id,
                )
                .values(last_read_at=now)
            )
    if channel in {"all", "telegram"}:
        await db.execute(
            pg_insert(WorkspaceMessageRead)
            .values(
                user_id=current_user.id,
                student_id=student.id,
                telegram_last_read_at=now,
            )
            .on_conflict_do_update(
                index_elements=[WorkspaceMessageRead.user_id, WorkspaceMessageRead.student_id],
                set_={"telegram_last_read_at": now},
            )
        )
    await db.commit()


@router.get("/students/{student_id}/messages")
async def workspace_student_messages(
    student_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    mentor_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=300, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    q: str | None = Query(default=None, max_length=200),
):
    """Return one read model for internal and Telegram messages.

    The source records stay in their existing tables.  This endpoint only
    normalizes and sorts them, so CRM and workspace always show the same data.
    """
    _require_staff(current_user)
    if mentor_id and current_user.role in (UserRole.admin, UserRole.mzk_manager):
        mentor = await db.get(User, mentor_id)
        if not mentor or mentor.role != UserRole.mentor:
            raise HTTPException(status_code=404, detail="Ментор не найден")
    student = await _require_workspace_student(db, current_user, student_id, mentor_id)
    perspective_user_id = mentor_id or current_user.id
    page_window = offset + limit + 1
    items: list[dict] = []

    if student.user_id:
        student_conversations = select(ConversationMember.conversation_id).where(
            ConversationMember.user_id == student.user_id
        )
        internal_query = (
            select(Message)
            .options(selectinload(Message.attachments))
            .where(Message.conversation_id.in_(student_conversations))
        )
        if mentor_id or current_user.role == UserRole.mentor:
            staff_conversations = select(ConversationMember.conversation_id).where(
                ConversationMember.user_id == perspective_user_id
            )
            internal_query = internal_query.where(Message.conversation_id.in_(staff_conversations))
        if q and q.strip():
            internal_query = internal_query.where(Message.body.ilike(f"%{q.strip()}%"))
        internal_result = await db.execute(
            internal_query.order_by(Message.created_at.desc(), Message.id.desc()).limit(page_window)
        )
        internal_messages = list(internal_result.scalars().all())
        sender_ids = {message.sender_id for message in internal_messages}
        senders: dict[uuid.UUID, User] = {}
        if sender_ids:
            sender_result = await db.execute(select(User).where(User.id.in_(sender_ids)))
            senders = {sender.id: sender for sender in sender_result.scalars().all()}
        for message in internal_messages:
            sender = senders.get(message.sender_id)
            items.append(
                {
                    "id": str(message.id),
                    "source": "internal",
                    "source_chat_id": str(message.conversation_id),
                    "sender_id": str(message.sender_id),
                    "sender_name": sender.name if sender else None,
                    "sender_role": sender.role.value if sender else "unknown",
                    "is_current_user": message.sender_id == perspective_user_id,
                    "body": message.body,
                    "message_type": "text",
                    "created_at": message.created_at.isoformat(),
                    "attachments": [
                        {
                            "id": str(attachment.id),
                            "kind": "internal",
                            "file_name": attachment.file_name,
                            "file_size": attachment.file_size,
                            "mime_type": attachment.mime_type,
                            "can_download": True,
                        }
                        for attachment in message.attachments
                    ],
                }
            )

    session_result = await db.execute(
        select(TelegramChatSession.id, TelegramChatSession.chat_id).where(
            TelegramChatSession.student_id == student_id
        )
    )
    session_rows = session_result.all()
    session_ids = [row[0] for row in session_rows]
    chat_ids = {row[1] for row in session_rows}
    if session_ids:
        telegram_query = (
            select(TelegramMessage)
            .options(selectinload(TelegramMessage.attachments))
            .where(TelegramMessage.session_id.in_(session_ids))
        )
        if q and q.strip():
            pattern = f"%{q.strip()}%"
            telegram_query = telegram_query.where(
                or_(TelegramMessage.raw_text.ilike(pattern), TelegramMessage.sender_name.ilike(pattern))
            )
        telegram_result = await db.execute(
            telegram_query
            .order_by(TelegramMessage.created_at.desc(), TelegramMessage.id.desc())
            .limit(page_window)
        )
        telegram_messages = list(telegram_result.scalars().all())
        identities: dict[tuple[uuid.UUID, int], TelegramParticipantIdentity] = {}
        if chat_ids:
            identity_result = await db.execute(
                select(TelegramParticipantIdentity).where(
                    TelegramParticipantIdentity.chat_id.in_(chat_ids)
                )
            )
            identities = {
                (identity.chat_id, identity.telegram_user_id): identity
                for identity in identity_result.scalars().all()
            }
        for message in telegram_messages:
            identity = identities.get((message.chat_id, message.sender_tg_id)) if message.sender_tg_id else None
            items.append(
                {
                    "id": str(message.id),
                    "source": "telegram",
                    "source_chat_id": str(message.chat_id),
                    "sender_id": str(message.sent_by_user_id or identity.user_id) if message.sent_by_user_id or (identity and identity.user_id) else None,
                    "sender_name": message.sender_name if message.sent_by_user_id else identity.display_name if identity else message.sender_name,
                    "sender_role": "staff" if message.sent_by_user_id else identity.role if identity else "unknown",
                    "is_current_user": bool(
                        message.sent_by_user_id == perspective_user_id
                        or (identity and identity.user_id == perspective_user_id)
                    ),
                    "body": message.raw_text,
                    "message_type": message.message_type.value,
                    "created_at": message.created_at.isoformat(),
                    "attachments": [
                        {
                            "id": str(attachment.id),
                            "kind": "telegram",
                            "file_name": attachment.file_name,
                            "file_size": attachment.file_size,
                            "mime_type": attachment.mime_type,
                            "can_download": bool(attachment.storage_path),
                        }
                        for attachment in message.attachments
                    ],
                }
            )

    page, has_more = _paginate_unified_items(items, offset, limit)
    return {
        "items": page,
        "total": len(page),
        "student_id": str(student.id),
        "offset": offset,
        "next_offset": offset + len(page) if has_more else None,
        "has_more": has_more,
    }


def _clean_context_strings(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [" ".join(str(item).split())[:500] for item in value if str(item).strip()][:20]


def _unified_context_markdown(body: dict) -> str:
    sections = [f"## Выжимка\n\n{str(body.get('summary') or '').strip() or 'Нет выжимки.'}"]
    labels = {
        "profile_notes": "Контекст профиля",
        "follow_ups": "Следующие действия",
        "document_flags": "Документы",
        "contradictions": "Противоречия",
        "quality_warnings": "Предупреждения качества",
    }
    for key, label in labels.items():
        values = _clean_context_strings(body.get(key))
        if values:
            sections.append(f"## {label}\n\n" + "\n".join(f"- {value}" for value in values))
    return "\n\n".join(sections)


@router.post("/students/{student_id}/context-draft")
async def create_workspace_context_draft(
    student_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_staff(current_user)
    mentor_id = uuid.UUID(str(body["mentor_id"])) if body.get("mentor_id") else None
    student = await _require_workspace_student(db, current_user, student_id, mentor_id)
    message_response = await workspace_student_messages(
        student_id=student_id,
        current_user=current_user,
        db=db,
        mentor_id=mentor_id,
        limit=max(5, min(int(body.get("limit") or 120), 120)),
        offset=0,
        q=str(body.get("q") or "").strip() or None,
    )
    messages = message_response["items"]
    if not messages:
        raise HTTPException(status_code=422, detail="Нет сообщений для анализа")
    source_text = "\n".join(
        f"[{message['source']} · {message.get('sender_name') or 'участник'}]: {message.get('body') or '[вложение]'}"
        for message in messages
    )
    attachments = [
        {"source": message["source"], **attachment}
        for message in messages
        for attachment in message.get("attachments", [])
    ]
    snapshot = snapshot_student(student)
    draft = await generate_context_review_draft(
        source_text=source_text,
        snapshot=snapshot,
        attachments=attachments,
    )
    ai_meta = draft.pop("__ai_meta", {})
    run = AiAnalysisRun(
        source_type="workspace_unified_context",
        source_id=student.id,
        student_id=student.id,
        source_last_message_id=(
            uuid.UUID(messages[-1]["id"]) if messages[-1]["source"] == "telegram" else None
        ),
        status="draft_created",
        prompt_version=str(ai_meta.get("prompt_version") or "unknown"),
        model=ai_meta.get("model"),
        input_snapshot={
            "message_count": len(messages),
            "source_text": source_text,
            "attachments": attachments,
            "profile_snapshot": snapshot,
        },
        raw_output=ai_meta.get("raw_output"),
        parsed_output=ai_meta.get("parsed_output") or draft,
        filter_reasons=ai_meta.get("filter_reasons") or {},
        created_by=current_user.id,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return {
        **draft,
        "draft_run_id": str(run.id),
        "source_text": source_text,
        "profile_snapshot": snapshot,
        "student_id": str(student.id),
        "student_name": student.full_name,
        "prompt_version": run.prompt_version,
        "model": run.model,
    }


@router.post("/students/{student_id}/context-draft/apply")
async def apply_workspace_context_draft(
    student_id: uuid.UUID,
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_staff(current_user)
    student = await _require_workspace_student(db, current_user, student_id)
    run_id = body.get("draft_run_id")
    if not run_id:
        raise HTTPException(status_code=422, detail="draft_run_id обязателен")
    run = await db.scalar(
        select(AiAnalysisRun)
        .where(
            AiAnalysisRun.id == uuid.UUID(str(run_id)),
            AiAnalysisRun.student_id == student.id,
            AiAnalysisRun.source_type == "workspace_unified_context",
        )
        .with_for_update()
    )
    if not run:
        raise HTTPException(status_code=404, detail="AI-черновик не найден")
    if run.status == "applied":
        raise HTTPException(status_code=409, detail="Этот AI-черновик уже применён")
    source_text = str(body.get("source_text") or "").strip()
    if not source_text:
        raise HTTPException(status_code=422, detail="source_text обязателен")
    profile_updates = body.get("profile_updates") if isinstance(body.get("profile_updates"), list) else []
    proposed_changes = {
        str(item.get("field")): item.get("value")
        for item in profile_updates
        if isinstance(item, dict) and item.get("field")
    }
    snapshot = snapshot_student(student)
    applied_changes = apply_student_updates(student, proposed_changes)
    for change in applied_changes:
        await log_change(
            db,
            "student",
            student.id,
            change["field"],
            change["old_value"],
            change["new_value"],
            str(current_user.id),
            source="workspace_unified_context",
        )
    follow_ups = _clean_context_strings(body.get("follow_ups"))
    created_tasks: list[StudentTask] = []
    for follow_up in follow_ups:
        task = StudentTask(
            student_id=student.id,
            task_text=follow_up,
            created_by=current_user.id,
            status=TaskStatus.open,
        )
        db.add(task)
        created_tasks.append(task)
    note = StudentNote(
        student_id=student.id,
        title="AI-разбор общей истории чата",
        source_text=source_text,
        summary_markdown=_unified_context_markdown(body),
        profile_snapshot=snapshot,
        suggested_changes={**proposed_changes, "profile_notes": _clean_context_strings(body.get("profile_notes"))},
        applied_changes={"changes": applied_changes, "tasks_created": len(follow_ups)},
        status=StudentNoteStatus.approved,
        created_by=current_user.id,
        reviewed_by=current_user.id,
        reviewed_at=datetime.now(timezone.utc),
    )
    db.add(note)
    await db.flush()
    await log_change(
        db, "student_note", note.id, "ai_context_applied", None, run.id,
        str(current_user.id), source="workspace_unified_context",
    )
    for task in created_tasks:
        await log_change(
            db, "student_task", task.id, "created_from_ai_context", None, run.id,
            str(current_user.id), source="workspace_unified_context",
        )
    run.status = "applied"
    run.parsed_output = {**(run.parsed_output or {}), "note_id": str(note.id)}
    await db.commit()
    return {
        "note_id": str(note.id),
        "applied_changes": applied_changes,
        "tasks_created": len(follow_ups),
    }


@router.get("/students/{student_id}/summary")
async def workspace_student_summary(
    student_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _require_staff(current_user)
    await require_student_access(db, student_id, current_user)
    student = await db.get(Student, student_id)
    if not student or student.is_archived:
        raise HTTPException(status_code=404, detail="Студент не найден")
    return await _student_summary(db, student)
