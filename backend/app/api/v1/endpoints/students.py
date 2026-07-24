from __future__ import annotations
import uuid
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, update
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.core.encryption import mask_iin, decrypt
from app.models.student import Student, DegreeLevel, IntakeSeason
from app.models.contract import Contract
from app.models.mentor_assignment import MentorAssignment
from app.models.guardian import Guardian
from app.models.confidential_note import ConfidentialNote, note_visible_to_role
from app.models.application import Application
from app.models.service import Service, ServiceStatus, ServiceType
from app.services.default_services import ensure_default_services
from app.services.people_facets import build_people_index
from app.models.document import Document
from app.models.communication_log import CommunicationLog
from app.models.pending_insight import InsightStatus, PendingInsight
from app.models.student_task import StudentTask, TaskStatus
from app.models.notification import Notification
from app.models.status_history import StatusHistory
from app.models.meeting import Meeting, MeetingStatus
from app.models.roadmap import Roadmap, RoadmapStatus, RoadmapTask, RoadmapItemStatus
from app.models.note_session import NoteSession
from app.models.student_note import StudentNote
from app.models.portfolio_progress import PortfolioProgress
from app.models.sync_status import SyncStatus
from app.models.telegram_chat_session import TelegramChatSession, TelegramSessionStatus
from app.models.telegram_message import TelegramMessage
from app.models.telegram_pairing_code import TelegramPairingCode
from app.models.intake_submission import IntakeSubmission
from app.models.notion_snapshot import NotionSnapshot
from app.models.user import User, UserRole
from app.schemas.student import StudentCreate, StudentUpdate

router = APIRouter(prefix="/students", tags=["students"])


class MergeStudentBody(BaseModel):
    target_student_id: uuid.UUID


def _timeline_item(
    *,
    item_id: uuid.UUID | str,
    at: datetime | None,
    kind: str,
    title: str | None,
    text: str | None = None,
    href: str | None = None,
    source: str | None = None,
    meta: dict | None = None,
) -> dict:
    return {
        "id": str(item_id),
        "at": at.isoformat() if at else None,
        "kind": kind,
        "title": title or "Событие",
        "text": text or "",
        "href": href,
        "source": source,
        "meta": meta or {},
    }


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


async def _count(db: AsyncSession, stmt) -> int:
    result = await db.execute(stmt)
    return int(result.scalar() or 0)


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


def _compute_duplicate_pairs(students: list[dict]) -> list[dict]:
    """Чистый CPU-проход: нормализация один раз на студента (O(n)),
    телефоны — через словарь, имена — по предвычисленным сжатым словам.
    Вызывается в thread pool, чтобы не блокировать event loop."""
    import sys
    sys.path.insert(0, "/app") if "/app" not in sys.path else None
    from migration.transformers.normalize import normalize_phone, squash_name, squashed_words_match

    for s in students:
        phone = normalize_phone(s["phone"] or "")
        s["_phone"] = phone if len(phone) >= 10 else ""
        s["_words"] = squash_name(s["full_name"]).split()

    def brief(s: dict) -> dict:
        return {"id": s["id"], "full_name": s["full_name"], "phone": s["phone"], "intake_year": s["intake_year"]}

    pairs = []
    seen: set[tuple[str, str]] = set()

    by_phone: dict[str, list[dict]] = {}
    for s in students:
        if s["_phone"]:
            by_phone.setdefault(s["_phone"], []).append(s)
    for bucket in by_phone.values():
        for i, a in enumerate(bucket):
            for b in bucket[i + 1:]:
                seen.add((a["id"], b["id"]))
                pairs.append({"reason": "phone", "a": brief(a), "b": brief(b)})

    for i, a in enumerate(students):
        for b in students[i + 1:]:
            if (a["id"], b["id"]) in seen:
                continue
            if squashed_words_match(a["_words"], b["_words"]):
                pairs.append({"reason": "name", "a": brief(a), "b": brief(b)})
    return pairs


@router.get("/duplicates")
async def find_duplicates(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Возможные дубли: совпадение телефона или транслит-совпадение ФИО.
    «Асель Иванова» и «Assel Ivanova» — скорее всего один человек."""
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Недостаточно прав")

    result = await db.execute(
        select(Student).where(Student.is_archived == False)  # noqa: E712
    )
    students = [
        {"id": str(s.id), "full_name": s.full_name, "phone": s.phone, "intake_year": s.intake_year}
        for s in result.scalars().all()
    ]

    import asyncio
    pairs = await asyncio.get_event_loop().run_in_executor(None, _compute_duplicate_pairs, students)
    return {"pairs": pairs, "total": len(pairs)}


@router.get("/facets")
async def student_facets(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Значения для фильтров списка — только те, что реально есть в данных,
    со счётчиком студентов по каждому."""
    active = Student.is_archived == False  # noqa: E712

    years_result = await db.execute(
        select(Student.intake_year, func.count())
        .where(active)
        .group_by(Student.intake_year)
        .order_by(Student.intake_year)
    )
    degrees_result = await db.execute(
        select(Student.degree_level, func.count())
        .where(active)
        .group_by(Student.degree_level)
    )
    statuses_result = await db.execute(
        select(Contract.pipeline_status, func.count(func.distinct(Contract.student_id)))
        .join(Student, Student.id == Contract.student_id)
        .where(active)
        .group_by(Contract.pipeline_status)
    )
    countries_result = await db.execute(
        select(Application.country, func.count(func.distinct(Application.student_id)))
        .join(Student, Student.id == Application.student_id)
        .where(active)
        .group_by(Application.country)
        .order_by(func.count(func.distinct(Application.student_id)).desc())
    )

    return {
        "years": [{"value": str(y), "count": c} for y, c in years_result.all() if y],
        "degrees": [{"value": d.value, "count": c} for d, c in degrees_result.all() if d],
        "statuses": sorted(
            ({"value": s.value, "count": c} for s, c in statuses_result.all() if s),
            key=lambda x: -x["count"],
        ),
        "countries": [{"value": co, "count": c} for co, c in countries_result.all() if co],
    }


@router.get("/people-facets")
async def student_people_facets(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Уникальные менторы и MZK-менеджеры для фильтров дашборда.
    Имена берутся из Notion-снэпшотов и канонизируются (транслит + сжатие),
    поэтому 'Aisulu'/'Aisulu (KG)' и 'Aruzhan'/'Аружан' не двоятся."""
    index = await build_people_index(db)
    return {
        "mentors": index.mentor_facets(),
        "managers": index.manager_facets(),
    }


@router.post("/{student_id}/merge")
async def merge_student(
    student_id: uuid.UUID,
    body: MergeStudentBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Недостаточно прав для соединения студентов")

    if student_id == body.target_student_id:
        raise HTTPException(status_code=400, detail="Нельзя соединить студента сам с собой")

    source = await db.get(Student, student_id)
    target = await db.get(Student, body.target_student_id)
    if not source or not target:
        raise HTTPException(status_code=404, detail="Студент не найден")
    if source.is_archived:
        raise HTTPException(status_code=400, detail="Источник уже архивирован")
    if target.is_archived:
        raise HTTPException(status_code=400, detail="Нельзя соединять в архивированного студента")

    now = datetime.now(timezone.utc)

    def norm(value: str | None) -> str:
        return " ".join(str(value or "").strip().lower().split())

    def copy_if_empty(field: str) -> None:
        source_val = getattr(source, field)
        target_val = getattr(target, field)
        if (target_val is None or target_val == "" or target_val == 0) and source_val not in (None, "", 0):
            setattr(target, field, source_val)

    copy_if_empty("city")
    copy_if_empty("age")
    copy_if_empty("specialty")
    copy_if_empty("group_direction")
    copy_if_empty("additional_sphere")
    copy_if_empty("gpa")
    copy_if_empty("achievements_text")
    copy_if_empty("budget_per_year")
    copy_if_empty("transcript_resume_url")
    copy_if_empty("intake_season")

    # Keep the main card stable: only backfill obvious gaps from the duplicate.
    if not target.full_name.strip():
        target.full_name = source.full_name
    if not target.phone.strip():
        target.phone = source.phone
    if target.intake_year is None:
        target.intake_year = source.intake_year
    if target.degree_level is None:
        target.degree_level = source.degree_level

    moved_counts: Counter[str] = Counter()

    # Move one-to-many operational links.
    for model, label in [
        (Contract, "contracts"),
        (Guardian, "guardians"),
        (Service, "services"),
        (ConfidentialNote, "confidential_notes"),
        (StudentTask, "student_tasks"),
        (Document, "documents"),
        (CommunicationLog, "communication_logs"),
        (PendingInsight, "pending_insights"),
        (NoteSession, "note_sessions"),
        (StudentNote, "notes"),
        (SyncStatus, "sync_status"),
        (TelegramChatSession, "telegram_chat_sessions"),
        (TelegramPairingCode, "telegram_pairing_codes"),
        (IntakeSubmission, "intake_submissions"),
        (NotionSnapshot, "notion_snapshots"),
    ]:
        result = await db.execute(
            update(model)
            .where(getattr(model, "student_id") == source.id)
            .values(student_id=target.id)
        )
        moved_counts[label] += result.rowcount or 0

    source_portfolio = (await db.execute(
        select(PortfolioProgress).where(PortfolioProgress.student_id == source.id)
    )).scalar_one_or_none()
    # target.portfolio_progress трогать нельзя: лениво грузить связь в async-сессии
    # нельзя (MissingGreenlet) — читаем явным запросом
    target_portfolio = (await db.execute(
        select(PortfolioProgress).where(PortfolioProgress.student_id == target.id)
    )).scalar_one_or_none()
    if source_portfolio and target_portfolio is None:
        source_portfolio.student_id = target.id
        moved_counts["portfolio_progress"] += 1

    # Merge applications with a simple dedupe by country; keep one primary.
    target_apps_result = await db.execute(select(Application).where(Application.student_id == target.id))
    target_apps = target_apps_result.scalars().all()
    target_country_keys = {norm(app.country) for app in target_apps}
    target_has_primary = any(app.is_primary for app in target_apps)

    source_apps_result = await db.execute(
        select(Application).where(Application.student_id == source.id).order_by(Application.id)
    )
    for app in source_apps_result.scalars().all():
        key = norm(app.country)
        if key in target_country_keys:
            continue
        if app.is_primary and target_has_primary:
            app.is_primary = False
        elif app.is_primary:
            target_has_primary = True
        app.student_id = target.id
        target_country_keys.add(key)
        moved_counts["applications"] += 1

    # Mentor assignments can collide for the same mentor/role/scope; skip exact duplicates.
    target_assignments_result = await db.execute(
        select(MentorAssignment).where(MentorAssignment.student_id == target.id)
    )
    assignment_keys = {
        (a.mentor_id, a.role.value, norm(a.country_scope), a.is_active)
        for a in target_assignments_result.scalars().all()
    }
    source_assignments_result = await db.execute(
        select(MentorAssignment).where(MentorAssignment.student_id == source.id)
    )
    for assignment in source_assignments_result.scalars().all():
        key = (assignment.mentor_id, assignment.role.value, norm(assignment.country_scope), assignment.is_active)
        if key in assignment_keys:
            continue
        assignment.student_id = target.id
        assignment_keys.add(key)
        moved_counts["mentor_assignments"] += 1

    # Подсказки-кандидаты в инбоксах не должны указывать на архивируемый дубль
    for model in (IntakeSubmission, NotionSnapshot):
        await db.execute(
            update(model)
            .where(getattr(model, "suggested_student_id") == source.id)
            .values(suggested_student_id=target.id)
        )

    source.is_archived = True
    source.updated_at = now
    target.updated_at = now

    await log_change(
        db,
        "student",
        target.id,
        "merged_from",
        str(source.id),
        source.full_name,
        str(current_user.id),
        "manual_merge",
    )
    await log_change(
        db,
        "student",
        source.id,
        "merged_into",
        None,
        str(target.id),
        str(current_user.id),
        "manual_merge",
    )

    await db.commit()
    return {
        "ok": True,
        "source_student_id": str(source.id),
        "target_student_id": str(target.id),
        "moved": dict(moved_counts),
    }


@router.get("")
async def list_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    search: str | None = None,
    pipeline_status: str | None = None,
    intake_year: int | None = None,
    degree_level: str | None = None,
    mzk_manager_id: uuid.UUID | None = None,
    lead_mentor_id: uuid.UUID | None = None,
    country: str | None = None,
    mentor_id: uuid.UUID | None = None,
    mentor_name: str | None = None,
    mzk_name: str | None = None,
    service_type: str | None = None,
    scope: str = Query("all", pattern="^(all|mine|assigned|unassigned)$"),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=2000),
):
    from app.models.application import Application

    # Менторы/менеджеры хранятся текстом в Notion-снэпшотах — индекс даёт и
    # канон-фильтры (mentor_name/mzk_name), и имена для карточек.
    people = await build_people_index(db)

    query = select(Student).where(Student.is_archived == False)  # noqa: E712

    # Фильтр по канон-ключу ментора/менеджера (пересечение, если оба заданы).
    if mentor_name or mzk_name:
        allowed: set[uuid.UUID] | None = None
        if mentor_name:
            allowed = set(people.mentor_students.get(mentor_name, set()))
        if mzk_name:
            mgr_ids = set(people.manager_students.get(mzk_name, set()))
            allowed = mgr_ids if allowed is None else (allowed & mgr_ids)
        query = query.where(Student.id.in_(allowed or set()))

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
    elif scope == "assigned":
        assigned_subquery = select(MentorAssignment.student_id).where(
            MentorAssignment.is_active == True,  # noqa: E712
        )
        query = query.where(Student.id.in_(assigned_subquery))

    if search:
        query = query.where(
            or_(
                Student.full_name.ilike(f"%{search}%"),
                Student.phone.ilike(f"%{search}%"),
            )
        )

    if intake_year:
        query = query.where(Student.intake_year == intake_year)

    if degree_level:
        try:
            query = query.where(Student.degree_level == DegreeLevel(degree_level))
        except ValueError:
            pass

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

    if service_type:
        try:
            svc_type = ServiceType(service_type)
            query = query.join(Service, Service.student_id == Student.id).where(
                Service.service_type == svc_type,
                Service.included == True,  # noqa: E712
            )
        except ValueError:
            query = query.where(False)

    if lead_mentor_id:
        query = query.join(Application, Application.student_id == Student.id, isouter=True)
        query = query.where(Application.lead_mentor_id == lead_mentor_id)

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

    # Страна для карточек дашборда — основная заявка (fallback: любая).
    # Один батч-запрос вместо N+1 по студентам.
    country_map: dict[uuid.UUID, str] = {}
    student_ids = [s.id for s in students]
    if student_ids:
        app_result = await db.execute(
            select(Application.student_id, Application.country)
            .where(Application.student_id.in_(student_ids))
            .order_by(Application.is_primary.desc(), Application.id)
        )
        for sid, app_country in app_result.all():
            if sid not in country_map and app_country:
                country_map[sid] = app_country

    # Батч-запросы вместо N+1: раньше здесь был цикл с ~14 отдельными запросами
    # к БД на каждого студента (до ~28000 запросов при size=2000, из-за чего
    # ответ мог занимать десятки секунд). Теперь один запрос на каждую связь
    # сразу по всем student_ids текущей страницы — по тому же принципу, что и
    # у country_map выше.
    contracts_by_student: dict[uuid.UUID, Contract] = {}
    if student_ids:
        contracts_result = await db.execute(
            select(Contract)
            .options(selectinload(Contract.mzk_manager))
            .where(Contract.student_id.in_(student_ids))
            .order_by(Contract.student_id, Contract.created_at.desc())
        )
        for c in contracts_result.scalars().all():
            contracts_by_student.setdefault(c.student_id, c)

    assignments_by_student: dict[uuid.UUID, list[MentorAssignment]] = defaultdict(list)
    if student_ids:
        assignments_result = await db.execute(
            select(MentorAssignment)
            .options(selectinload(MentorAssignment.mentor))
            .where(MentorAssignment.student_id.in_(student_ids))
            .order_by(MentorAssignment.student_id, MentorAssignment.assigned_at.desc())
        )
        for a in assignments_result.scalars().all():
            assignments_by_student[a.student_id].append(a)

    services_by_student: dict[uuid.UUID, list[dict]] = defaultdict(list)
    if student_ids:
        services_result = await db.execute(
            select(Service, User.name)
            .join(User, User.id == Service.assigned_mentor_id, isouter=True)
            .where(Service.student_id.in_(student_ids), Service.included == True)  # noqa: E712
            .order_by(Service.student_id, Service.service_type)
        )
        for service, mentor_name in services_result.all():
            services_by_student[service.student_id].append({
                "id": str(service.id),
                "service_type": service.service_type.value,
                "status": service.status.value,
                "assigned_mentor_id": str(service.assigned_mentor_id) if service.assigned_mentor_id else None,
                "assigned_staff_id": str(service.assigned_mentor_id) if service.assigned_mentor_id else None,
                "assigned_mentor_name": mentor_name,
                "deadline": service.deadline.isoformat() if service.deadline else None,
            })

    roadmap_by_student: dict[uuid.UUID, Roadmap] = {}
    if student_ids:
        roadmap_result = await db.execute(
            select(Roadmap)
            .where(Roadmap.student_id.in_(student_ids), Roadmap.status == RoadmapStatus.active)
            .order_by(Roadmap.student_id, Roadmap.created_at.desc())
        )
        for r in roadmap_result.scalars().all():
            roadmap_by_student.setdefault(r.student_id, r)

    roadmap_tasks_total_by_roadmap: dict[uuid.UUID, int] = {}
    roadmap_tasks_done_by_roadmap: dict[uuid.UUID, int] = {}
    roadmap_ids = [r.id for r in roadmap_by_student.values()]
    if roadmap_ids:
        totals_result = await db.execute(
            select(RoadmapTask.roadmap_id, func.count())
            .where(RoadmapTask.roadmap_id.in_(roadmap_ids))
            .group_by(RoadmapTask.roadmap_id)
        )
        roadmap_tasks_total_by_roadmap = dict(totals_result.all())
        done_result = await db.execute(
            select(RoadmapTask.roadmap_id, func.count())
            .where(
                RoadmapTask.roadmap_id.in_(roadmap_ids),
                RoadmapTask.status == RoadmapItemStatus.done,
            )
            .group_by(RoadmapTask.roadmap_id)
        )
        roadmap_tasks_done_by_roadmap = dict(done_result.all())

    open_tasks_by_student: dict[uuid.UUID, int] = {}
    if student_ids:
        open_tasks_result = await db.execute(
            select(StudentTask.student_id, func.count())
            .where(StudentTask.student_id.in_(student_ids), StudentTask.status == TaskStatus.open)
            .group_by(StudentTask.student_id)
        )
        open_tasks_by_student = dict(open_tasks_result.all())

    next_meeting_by_student: dict[uuid.UUID, Meeting] = {}
    if student_ids:
        next_meeting_result = await db.execute(
            select(Meeting)
            .where(
                Meeting.student_id.in_(student_ids),
                Meeting.status == MeetingStatus.scheduled,
                Meeting.ends_at >= datetime.now(timezone.utc),
            )
            .order_by(Meeting.student_id, Meeting.starts_at.asc())
        )
        for m in next_meeting_result.scalars().all():
            next_meeting_by_student.setdefault(m.student_id, m)

    telegram_session_by_student: dict[uuid.UUID, TelegramChatSession] = {}
    if student_ids:
        telegram_session_result = await db.execute(
            select(TelegramChatSession)
            .where(
                TelegramChatSession.student_id.in_(student_ids),
                TelegramChatSession.status == TelegramSessionStatus.active,
            )
            .order_by(TelegramChatSession.student_id, TelegramChatSession.opened_at.desc())
        )
        for t in telegram_session_result.scalars().all():
            telegram_session_by_student.setdefault(t.student_id, t)

    telegram_pending_by_student: dict[uuid.UUID, int] = {}
    if student_ids:
        telegram_pending_result = await db.execute(
            select(PendingInsight.student_id, func.count())
            .where(
                PendingInsight.student_id.in_(student_ids),
                PendingInsight.status == InsightStatus.pending,
                PendingInsight.source_telegram_message_id.is_not(None),
            )
            .group_by(PendingInsight.student_id)
        )
        telegram_pending_by_student = dict(telegram_pending_result.all())

    documents_unverified_by_student: dict[uuid.UUID, int] = {}
    if student_ids:
        docs_unverified_result = await db.execute(
            select(Document.student_id, func.count())
            .where(Document.student_id.in_(student_ids), Document.is_verified == False)  # noqa: E712
            .group_by(Document.student_id)
        )
        documents_unverified_by_student = dict(docs_unverified_result.all())

    comm_last_by_student: dict[uuid.UUID, tuple] = {}
    if student_ids:
        comm_last_result = await db.execute(
            select(CommunicationLog.student_id, CommunicationLog.source, CommunicationLog.created_at)
            .where(CommunicationLog.student_id.in_(student_ids))
            .order_by(CommunicationLog.student_id, CommunicationLog.created_at.desc())
        )
        for sid, source, created_at in comm_last_result.all():
            comm_last_by_student.setdefault(sid, (source, created_at))

    active_session_ids = [t.id for t in telegram_session_by_student.values()]
    telegram_last_by_session: dict[uuid.UUID, datetime] = {}
    if active_session_ids:
        telegram_msg_result = await db.execute(
            select(TelegramMessage.session_id, func.max(TelegramMessage.created_at))
            .where(TelegramMessage.session_id.in_(active_session_ids))
            .group_by(TelegramMessage.session_id)
        )
        telegram_last_by_session = dict(telegram_msg_result.all())

    meeting_last_by_student: dict[uuid.UUID, datetime] = {}
    if student_ids:
        meeting_last_result = await db.execute(
            select(Meeting.student_id, func.max(Meeting.starts_at))
            .where(Meeting.student_id.in_(student_ids), Meeting.status == MeetingStatus.completed)
            .group_by(Meeting.student_id)
        )
        meeting_last_by_student = dict(meeting_last_result.all())

    items = []
    for s in students:
        contract = contracts_by_student.get(s.id)
        days_in_work = None
        pipeline_status_val = None
        if contract:
            if contract.signed_date:
                days_in_work = (date.today() - contract.signed_date).days
            pipeline_status_val = contract.pipeline_status.value if contract.pipeline_status else None

        assignments = assignments_by_student.get(s.id, [])
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
        is_mine = any(a.mentor_id == current_user.id and a.is_active for a in assignments)

        service_items = services_by_student.get(s.id, [])
        service_status_counts = Counter(item["status"] for item in service_items)

        active_roadmap = roadmap_by_student.get(s.id)
        roadmap_progress = None
        roadmap_tasks_total = 0
        roadmap_tasks_done = 0
        if active_roadmap:
            roadmap_tasks_total = roadmap_tasks_total_by_roadmap.get(active_roadmap.id, 0)
            roadmap_tasks_done = roadmap_tasks_done_by_roadmap.get(active_roadmap.id, 0)
            roadmap_progress = round((roadmap_tasks_done / roadmap_tasks_total) * 100) if roadmap_tasks_total else 0

        open_tasks_count = open_tasks_by_student.get(s.id, 0)
        next_meeting = next_meeting_by_student.get(s.id)
        telegram_session = telegram_session_by_student.get(s.id)
        telegram_pending = telegram_pending_by_student.get(s.id, 0)
        documents_unverified = documents_unverified_by_student.get(s.id, 0)

        last_contact: dict | None = None
        comm_last = comm_last_by_student.get(s.id)
        if comm_last:
            last_contact = {"source": comm_last[0].value, "at": comm_last[1].isoformat()}

        telegram_last = telegram_last_by_session.get(telegram_session.id) if telegram_session else None
        if telegram_last and (last_contact is None or telegram_last > datetime.fromisoformat(last_contact["at"])):
            last_contact = {"source": "telegram", "at": telegram_last.isoformat()}

        meeting_last = meeting_last_by_student.get(s.id)
        if meeting_last and (last_contact is None or meeting_last > datetime.fromisoformat(last_contact["at"])):
            last_contact = {"source": "meeting", "at": meeting_last.isoformat()}

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
            "country": country_map.get(s.id),
            "mentors": people.student_mentor_labels.get(s.id, []),
            "mzk_manager_name": (
                contract.mzk_manager.name if contract and contract.mzk_manager
                else people.student_manager_label.get(s.id)
            ),
            "responsibles": responsibles,
            "responsible_count": len([r for r in responsibles if r["is_active"]]),
            "services_summary": {
                "total": len(service_items),
                "in_progress": service_status_counts.get(ServiceStatus.in_progress.value, 0),
                "scheduled": service_status_counts.get(ServiceStatus.scheduled.value, 0),
                "completed": service_status_counts.get(ServiceStatus.completed.value, 0),
                "items": service_items,
            },
            "has_portal_access": bool(s.user_id),
            "roadmap": {
                "id": str(active_roadmap.id) if active_roadmap else None,
                "name": active_roadmap.name if active_roadmap else None,
                "progress": roadmap_progress,
                "tasks_total": roadmap_tasks_total,
                "tasks_done": roadmap_tasks_done,
            },
            "open_tasks_count": open_tasks_count,
            "next_meeting": (
                {
                    "id": str(next_meeting.id),
                    "title": next_meeting.title,
                    "starts_at": next_meeting.starts_at.isoformat(),
                }
                if next_meeting else None
            ),
            "telegram": {
                "linked": bool(telegram_session),
                "chat_id": str(telegram_session.chat_id) if telegram_session else None,
                "pending_signals": telegram_pending,
            },
            "documents_unverified": documents_unverified,
            "last_contact": last_contact,
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

    await ensure_default_services(db, student.id)

    await log_change(
        db, "student", student.id, "created", None, student.full_name,
        str(current_user.id), "manual"
    )

    admins_result = await db.execute(
        select(User).where(
            User.role.in_([UserRole.admin, UserRole.mzk_manager]),
            User.id != current_user.id,
        )
    )
    for admin in admins_result.scalars():
        db.add(Notification(
            user_id=admin.id,
            kind="student_created",
            title="Новый студент добавлен",
            body=f"{current_user.name} добавил(а) студента {student.full_name}",
            link=f"/students/{student.id}",
            priority="normal",
        ))

    await db.commit()

    # Перечитываем с eager-load: _student_to_dict обходит relationships
    # (в т.ч. только что созданные услуги), а lazy-load в async падает.
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.applications),
            selectinload(Student.services),
            selectinload(Student.portfolio_progress),
            selectinload(Student.documents),
            selectinload(Student.student_tasks),
            selectinload(Student.mentor_assignments),
            selectinload(Student.communication_logs),
            selectinload(Student.pending_insights),
            selectinload(Student.notes),
        )
        .where(Student.id == student.id)
    )
    return _student_to_dict(result.scalar_one())


@router.get("/{student_id}/timeline")
async def get_student_timeline(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Unified staff timeline for CRM card and workspace.

    This intentionally aggregates read-only operational events without changing
    source tables. Pagination is applied after cross-source sorting.
    """
    student_result = await db.execute(
        select(Student.id).where(
            Student.id == student_id,
            Student.is_archived == False,  # noqa: E712
        )
    )
    if student_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Студент не найден")

    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        mentor_student_ids = await _get_mentor_student_ids(db, current_user.id)
        if not _can_see_student(current_user, student_id, mentor_student_ids):
            raise HTTPException(status_code=404, detail="Студент не найден")

    fetch_limit = min(max(limit + offset, limit), 500)
    events: list[dict] = []

    documents = (
        await db.execute(
            select(Document)
            .where(Document.student_id == student_id)
            .order_by(Document.uploaded_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"document:{doc.id}",
            at=doc.uploaded_at,
            kind="Документ",
            title=doc.file_name,
            text=f"{doc.doc_type.value} · {'проверен' if doc.is_verified else 'на проверке'}",
            href="#documents",
            source=doc.source.value if doc.source else None,
            meta={"document_id": str(doc.id), "visible_to_student": doc.visible_to_student},
        )
        for doc in documents
    )

    tasks = (
        await db.execute(
            select(StudentTask)
            .where(StudentTask.student_id == student_id)
            .order_by(StudentTask.created_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"task:{task.id}",
            at=task.done_at or task.created_at,
            kind="Задача закрыта" if task.status.value == "done" else "Задача",
            title=task.task_text,
            text="Выполнена" if task.status.value == "done" else "Открыта",
            href="#tasks",
            source="task",
            meta={"task_id": str(task.id), "status": task.status.value},
        )
        for task in tasks
    )

    meetings = (
        await db.execute(
            select(Meeting)
            .where(Meeting.student_id == student_id)
            .order_by(Meeting.starts_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"meeting:{meeting.id}",
            at=meeting.starts_at,
            kind="Встреча",
            title=meeting.title,
            text=meeting.outcome or meeting.description or meeting.status.value,
            href=f"/workspace/students/{student_id}?tab=meetings",
            source="meeting",
            meta={
                "meeting_id": str(meeting.id),
                "status": meeting.status.value,
                "meeting_type": meeting.meeting_type.value,
            },
        )
        for meeting in meetings
    )

    communication_logs = (
        await db.execute(
            select(CommunicationLog)
            .where(CommunicationLog.student_id == student_id)
            .order_by(CommunicationLog.created_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"communication:{log.id}",
            at=log.created_at,
            kind=log.source.value,
            title=log.ai_summary or log.raw_text or log.message_type.value,
            text=log.raw_text or log.ai_summary or "",
            href="#timeline",
            source=log.source.value,
            meta={"communication_log_id": str(log.id), "message_type": log.message_type.value},
        )
        for log in communication_logs
    )

    telegram_messages = (
        await db.execute(
            select(TelegramMessage)
            .join(TelegramChatSession, TelegramMessage.session_id == TelegramChatSession.id)
            .where(TelegramChatSession.student_id == student_id)
            .order_by(TelegramMessage.created_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"telegram:{message.id}",
            at=message.created_at,
            kind="Telegram",
            title=message.raw_text or message.message_type.value,
            text=message.sender_name or "",
            href=f"/telegram-inbox/{message.chat_id}",
            source="telegram",
            meta={
                "telegram_message_id": message.telegram_message_id,
                "chat_id": str(message.chat_id),
                "message_type": message.message_type.value,
            },
        )
        for message in telegram_messages
    )

    notes = (
        await db.execute(
            select(StudentNote)
            .where(StudentNote.student_id == student_id)
            .order_by(StudentNote.created_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"note:{note.id}",
            at=note.reviewed_at or note.created_at,
            kind="AI-черновик" if note.status.value == "draft" else "Конспект",
            title=note.title,
            text=note.status.value,
            href=f"/notes/{note.id}",
            source="note",
            meta={"note_id": str(note.id), "status": note.status.value},
        )
        for note in notes
    )

    insights = (
        await db.execute(
            select(PendingInsight)
            .where(PendingInsight.student_id == student_id)
            .order_by(PendingInsight.created_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"insight:{insight.id}",
            at=insight.created_at,
            kind="AI-сигнал",
            title=insight.insight_type.value,
            text=f"{insight.status.value} · {round(float(insight.confidence or 0) * 100)}%",
            href="#timeline",
            source="ai",
            meta={"insight_id": str(insight.id), "status": insight.status.value},
        )
        for insight in insights
    )

    history_entries = (
        await db.execute(
            select(StatusHistory)
            .where(
                StatusHistory.entity_type == "student",
                StatusHistory.entity_id == student_id,
            )
            .order_by(StatusHistory.changed_at.desc())
            .limit(fetch_limit)
        )
    ).scalars().all()
    events.extend(
        _timeline_item(
            item_id=f"history:{entry.id}",
            at=entry.changed_at,
            kind="Изменение CRM",
            title=entry.field_changed,
            text=f"{entry.old_value or '—'} → {entry.new_value or '—'}",
            href="#history",
            source=entry.source,
            meta={"history_id": str(entry.id), "changed_by": entry.changed_by},
        )
        for entry in history_entries
    )

    events = [event for event in events if event["at"]]
    events.sort(key=lambda event: event["at"], reverse=True)
    return {"items": events[offset:offset + limit], "total": len(events), "limit": limit, "offset": offset}


@router.get("/{student_id}")
async def get_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    query = (
        select(Student)
        .where(Student.id == student_id)
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
    )
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        query = query.where(Student.is_archived == False)  # noqa: E712
    result = await db.execute(
        query
    )
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    data = _student_to_dict(student)
    responsibles, is_mine = await _student_responsibles(db, student.id, current_user.id)
    data["responsibles"] = responsibles
    data["is_mine"] = is_mine

    # Product mode: role is not an access boundary; "mine" is a work filter.
    if current_user.role in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor):
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
                "visible_to_student": c.visible_to_student,
                "created_by": str(c.created_by),
                "created_at": c.created_at.isoformat(),
            }
            for c in conf_notes
            if note_visible_to_role(c.visible_to_role, current_user.role)
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

    # _student_to_dict обходит relationships — перечитываем с eager-load,
    # иначе async lazy-load падает с MissingGreenlet
    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.applications),
            selectinload(Student.services),
            selectinload(Student.portfolio_progress),
            selectinload(Student.documents),
            selectinload(Student.student_tasks),
            selectinload(Student.mentor_assignments),
            selectinload(Student.communication_logs),
            selectinload(Student.pending_insights),
            selectinload(Student.notes),
        )
        .where(Student.id == student_id)
    )
    return _student_to_dict(result.scalar_one())


@router.delete("/{student_id}")
async def archive_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Недостаточно прав для архивирования студентов")
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
                "assigned_staff_id": str(svc.assigned_mentor_id) if svc.assigned_mentor_id else None,
                "deadline": svc.deadline.isoformat() if svc.deadline else None,
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
                "visible_to_student": d.visible_to_student,
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
