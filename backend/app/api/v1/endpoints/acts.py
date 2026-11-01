from __future__ import annotations

import asyncio
import re
import smtplib
import uuid
from datetime import date, datetime, time, timezone
from io import BytesIO
from typing import Annotated, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pypdf import PdfReader
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.trustme import _client, _signers, _upstream
from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentStudent, CurrentUser
from app.core.permissions import Action, require_access
from app.models.guardian import Guardian
from app.models.meeting import Meeting, MeetingStatus
from app.models.mentor_assignment import MentorAssignment
from app.models.service_act import ActMailAttempt, ServiceAct
from app.models.student import Student
from app.models.trustme_contract import TrustMeContractLink
from app.models.user import User, UserRole
from app.schemas.service_act import ActInput, ActMailInput, ActMailResolution
from app.services import mailer
from app.services.act_pdf import render_act
from app.services.minio_service import minio_delete, minio_download, minio_upload
from app.services.trustme import TrustMeError

router = APIRouter(prefix="/acts", tags=["acts"])
Db = Annotated[AsyncSession, Depends(get_db)]


def _assignment(user):
    return select(MentorAssignment.student_id).where(
        MentorAssignment.mentor_id == user.id, MentorAssignment.is_active.is_(True),
        MentorAssignment.assignment_status == "active")


def _can_prepare(user):
    try:
        require_access(user, "acts", Action.manage)
        return True
    except HTTPException:
        return False


def _visible_acts(user):
    return True if _can_prepare(user) else ServiceAct.status == "ready"


async def _student(db, sid, user, *, manage=False):
    require_access(user, "acts", Action.manage if manage else Action.view)
    if user.role == UserRole.mentor:
        assigned = (await db.execute(_assignment(user).where(MentorAssignment.student_id == sid))).first()
        if not assigned:
            raise HTTPException(404, "Студент не найден")
    student = await db.get(Student, sid)
    if student is None:
        raise HTTPException(404, "Студент не найден")
    return student


async def _act(db, aid, user, *, manage=False, lock=False):
    require_access(user, "acts", Action.manage if manage else Action.view)
    stmt = select(ServiceAct).where(ServiceAct.id == aid)
    if lock:
        stmt = stmt.with_for_update()
    act = (await db.execute(stmt)).scalar_one_or_none()
    if act is None:
        raise HTTPException(404, "Акт не найден")
    await _student(db, act.student_id, user, manage=manage)
    if act.status == "draft" and not _can_prepare(user):
        raise HTTPException(404, "Акт не найден")
    return act


def _mail_dict(row):
    return {"id": str(row.id), "recipient": row.recipient, "subject": row.subject,
            "status": row.status, "created_at": row.created_at.isoformat(),
            "finished_at": row.finished_at.isoformat() if row.finished_at else None}


def _act_dict(row, *, snapshot=True):
    result = {"id": str(row.id), "status": row.status, "file_name": row.file_name,
              "student_name": row.snapshot["student_name"], "template": row.snapshot["template"],
              "act_date": row.snapshot["act_date"], "created_at": row.created_at.isoformat(),
              "shared": row.shared_at is not None, "supersedes_id": str(row.supersedes_id) if row.supersedes_id else None}
    result["created_by"] = str(row.created_by) if getattr(row, "created_by", None) else None
    if snapshot:
        result["snapshot"] = row.snapshot
    return result


def _pdf_response(content, name, *, inline=False):
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="act.pdf"; filename*=UTF-8\'\'{quote(name)}',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


async def _link(db, sid, link_id):
    link = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.id == link_id).with_for_update())).scalar_one_or_none()
    if link is None or link.student_id != sid:
        raise HTTPException(404, "Привязанный договор не найден")
    return link


async def _verify_contract(link):
    try:
        async with _client() as client:
            data = await client.contract(link.short_url)
            if client.company_id != link.company_id or data.get("id") != link.external_id:
                raise HTTPException(409, "Привязка договора не соответствует подключённой компании")
    except TrustMeError as error:
        raise _upstream(error) from None
    if data.get("contract_status") != 3:
        raise HTTPException(409, "Договор больше не имеет статуса «Подписан»")


@router.get("/registry")
async def registry(db: Db, current_user: CurrentUser, q: str = Query("", max_length=300),
                   kind: Literal["all", "contracts", "acts", "no_contract", "no_act"] = "all",
                   mail_status: Literal["all", "sent", "sending", "failed", "unknown"] = "all",
                   responsible_id: uuid.UUID | None = None,
                   date_from: date | None = None, date_to: date | None = None,
                   page: int = Query(1, ge=1), page_size: int = Query(30, ge=1, le=100)):
    require_access(current_user, "acts", Action.view)
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "Начало периода должно быть не позже окончания")
    contract_exists = select(TrustMeContractLink.id).where(TrustMeContractLink.student_id == Student.id).exists()
    act_exists = select(ServiceAct.id).where(ServiceAct.student_id == Student.id, _visible_acts(current_user)).exists()
    stmt = select(Student).where(Student.is_archived.is_(False))
    if current_user.role == UserRole.mentor:
        stmt = stmt.where(Student.id.in_(_assignment(current_user)))
    if q.strip():
        pattern = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        stmt = stmt.where(or_(Student.full_name.ilike(pattern, escape="\\"),
            select(ServiceAct.id).where(ServiceAct.student_id == Student.id, _visible_acts(current_user),
                or_(ServiceAct.snapshot["student_name"].as_string().ilike(pattern, escape="\\"),
                    ServiceAct.snapshot["contract_number"].as_string().ilike(pattern, escape="\\"))).exists(),
            select(TrustMeContractLink.id).where(TrustMeContractLink.student_id == Student.id,
                TrustMeContractLink.name.ilike(pattern, escape="\\")).exists()))
    if kind != "all":
        stmt = stmt.where({"contracts": contract_exists, "acts": act_exists,
                           "no_contract": ~contract_exists, "no_act": ~act_exists}[kind])
    if responsible_id:
        stmt = stmt.where(Student.id.in_(select(MentorAssignment.student_id).where(
            MentorAssignment.mentor_id == responsible_id, MentorAssignment.is_active.is_(True),
            MentorAssignment.assignment_status == "active")))
    if date_from or date_to:
        dated = select(ServiceAct.id).where(ServiceAct.student_id == Student.id, _visible_acts(current_user))
        if date_from:
            dated = dated.where(ServiceAct.snapshot["act_date"].as_string() >= date_from.isoformat())
        if date_to:
            dated = dated.where(ServiceAct.snapshot["act_date"].as_string() <= date_to.isoformat())
        stmt = stmt.where(dated.exists())
    if mail_status != "all":
        stmt = stmt.where(select(ActMailAttempt.id).join(ServiceAct, ServiceAct.id == ActMailAttempt.act_id).where(
            ServiceAct.student_id == Student.id, _visible_acts(current_user),
            ActMailAttempt.status.in_(("sent", "confirmed_sent")) if mail_status == "sent"
            else ActMailAttempt.status == mail_status).exists())
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    students = (await db.execute(stmt.order_by(Student.full_name, Student.id).offset((page-1)*page_size).limit(page_size))).scalars().all()
    ids = [s.id for s in students]
    contracts = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id.in_(ids)))).scalars().all() if ids else []
    acts = (await db.execute(select(ServiceAct).where(ServiceAct.student_id.in_(ids), _visible_acts(current_user)).order_by(ServiceAct.created_at.desc()))).scalars().all() if ids else []
    return {"total": total, "page": page, "items": [{"student_id": str(s.id), "student_name": s.full_name,
        "contracts_count": sum(c.student_id == s.id for c in contracts),
        "acts_count": sum(a.student_id == s.id and a.status == "ready" for a in acts),
        "drafts_count": sum(a.student_id == s.id and a.status == "draft" for a in acts)} for s in students]}


@router.get("/responsibles")
async def responsibles(db: Db, current_user: CurrentUser):
    require_access(current_user, "acts", Action.view)
    if current_user.role == UserRole.mentor:
        return [{"id": str(current_user.id), "name": current_user.name}]
    rows = (await db.execute(select(User.id, User.name).where(User.id.in_(
        select(MentorAssignment.mentor_id).where(MentorAssignment.is_active.is_(True),
            MentorAssignment.assignment_status == "active"))).order_by(User.name))).all()
    return [{"id": str(uid), "name": name} for uid, name in rows]


@router.get("/students/{student_id}")
async def student_acts(student_id: uuid.UUID, db: Db, current_user: CurrentUser,
                       period_start: date | None = None, period_end: date | None = None):
    student = await _student(db, student_id, current_user)
    links = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id == student_id))).scalars().all()
    acts = (await db.execute(select(ServiceAct).where(ServiceAct.student_id == student_id, _visible_acts(current_user)).order_by(ServiceAct.created_at.desc()))).scalars().all()
    authors = dict((await db.execute(select(User.id, User.name).where(User.id.in_(
        [a.created_by for a in acts if a.created_by])))).all()) if acts else {}
    attempts = (await db.execute(select(ActMailAttempt).where(ActMailAttempt.act_id.in_([a.id for a in acts])).order_by(ActMailAttempt.created_at.desc()))).scalars().all() if acts else []
    count = None
    if period_start and period_end:
        if period_end < period_start:
            raise HTTPException(422, "Проверьте период")
        tz = ZoneInfo("Asia/Almaty")
        count = (await db.execute(select(func.count(Meeting.id)).where(Meeting.student_id == student_id,
            Meeting.status == MeetingStatus.completed,
            Meeting.starts_at >= datetime.combine(period_start, time.min, tz),
            Meeting.starts_at <= datetime.combine(period_end, time.max, tz)))).scalar_one()
    guardians = (await db.execute(select(Guardian).where(Guardian.student_id == student_id))).scalars().all()
    portal_user = await db.get(User, student.user_id) if student.user_id else None
    return {"student_name": student.full_name, "completed_meetings": count,
        "mail_configured": mailer.is_configured(),
        "recipient_suggestions": list(dict.fromkeys([g.email for g in guardians if g.email] + ([portal_user.email] if portal_user else []))),
        "contracts": [{"id": str(c.id), "name": c.name, "number": c.number, "status": c.status,
                       "short_url": c.short_url, "signers": c.signers, "financial_contract_id": str(c.financial_contract_id) if c.financial_contract_id else None} for c in links],
        "acts": [{**_act_dict(a), "author_name": authors.get(a.created_by),
                  "mail": [_mail_dict(m) for m in attempts if m.act_id == a.id]} for a in acts]}


@router.get("/students/{student_id}/contracts/{link_id}/pdf")
async def contract_pdf(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user)
    link = await _link(db, student_id, link_id)
    try:
        async with _client() as client:
            if client.company_id != link.company_id:
                raise HTTPException(409, "Договор относится к другой компании")
            content = await client.pdf(link.short_url)
    except TrustMeError as error:
        raise _upstream(error) from None
    return _pdf_response(content, f"Договор - {link.short_url}.pdf", inline=True)


def _extract_pages(content):
    reader = PdfReader(BytesIO(content))
    if reader.is_encrypted or len(reader.pages) > 80:
        raise ValueError("Для этого PDF требуется ручная проверка")
    return [{"page": i+1, "text": (page.extract_text() or "")[:6000]} for i, page in enumerate(reader.pages)]


@router.post("/students/{student_id}/contracts/{link_id}/inspect")
async def inspect_contract(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = await _link(db, student_id, link_id)
    try:
        async with _client() as client:
            if client.company_id != link.company_id:
                raise HTTPException(409, "Договор относится к другой компании")
            info = await client.contract(link.short_url)
            content = await client.pdf(link.short_url)
        pages = await asyncio.to_thread(_extract_pages, content)
    except TrustMeError as error:
        raise _upstream(error) from None
    except Exception as error:
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(422, "Не удалось прочитать текст PDF; откройте договор и заполните поля вручную") from None
    first = pages[0]["text"] if pages else ""
    number = re.search(r"(?:ДОГОВОР|Договор)[^№\n]{0,150}№\s*([^\s,;]{1,50})", first)
    return {"pages": pages, "suggested_contract_number": number.group(1) if number else None,
            "signers": _signers(info.get("doc_parties") or [], "requisites"),
            "requires_verification": True}


async def _validate_input(db, sid, data):
    link = await _link(db, sid, data.contract_link_id)
    if data.supersedes_id:
        previous = await db.get(ServiceAct, data.supersedes_id)
        if previous is None or previous.student_id != sid or previous.status != "ready":
            raise HTTPException(422, "Нельзя заменить этот акт")
    return link


@router.post("/students/{student_id}/preview")
async def preview(student_id: uuid.UUID, body: ActInput, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    await _validate_input(db, student_id, body)
    content = await asyncio.to_thread(render_act, body, draft=True)
    return _pdf_response(content, body.filename(), inline=True)


@router.post("/students/{student_id}", status_code=201)
async def create_draft(student_id: uuid.UUID, body: ActInput, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    await _validate_input(db, student_id, body)
    act = ServiceAct(student_id=student_id, contract_link_id=body.contract_link_id,
        created_by=current_user.id, snapshot=body.model_dump(mode="json"), supersedes_id=body.supersedes_id)
    db.add(act)
    await db.flush()
    await log_change(db, "student", student_id, "act_draft_created", None, str(act.id), str(current_user.id))
    await db.commit()
    return _act_dict(act)


@router.put("/{act_id}")
async def update_draft(act_id: uuid.UUID, body: ActInput, db: Db, current_user: CurrentUser):
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    if act.status != "draft":
        raise HTTPException(409, "Готовый PDF неизменяем; создайте новую версию")
    await _validate_input(db, act.student_id, body)
    act.snapshot = body.model_dump(mode="json")
    act.contract_link_id = body.contract_link_id
    act.supersedes_id = body.supersedes_id
    await log_change(db, "student", act.student_id, "act_draft_updated", None, str(act.id), str(current_user.id))
    await db.commit()
    return _act_dict(act)


@router.post("/{act_id}/generate")
async def generate(act_id: uuid.UUID, db: Db, current_user: CurrentUser):
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    if act.status == "ready":
        return _act_dict(act)
    data = ActInput.model_validate(act.snapshot)
    try:
        data.require_verified()
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    link = await _validate_input(db, act.student_id, data)
    await _verify_contract(link)
    content = await asyncio.to_thread(render_act, data)
    path = await minio_upload(content, act.student_id, data.filename(), "application/pdf")
    try:
        act.storage_path, act.file_name, act.status = path, data.filename(), "ready"
        act.generated_at = datetime.now(timezone.utc)
        await log_change(db, "student", act.student_id, "act_generated", None, str(act.id), str(current_user.id))
        await db.commit()
    except Exception:
        await db.rollback()
        await minio_delete(path)
        raise
    return _act_dict(act)


@router.get("/{act_id}/pdf")
async def download(act_id: uuid.UUID, db: Db, current_user: CurrentUser):
    act = await _act(db, act_id, current_user)
    if act.status != "ready" or not act.storage_path:
        raise HTTPException(409, "Сначала сформируйте PDF")
    return _pdf_response(await minio_download(act.storage_path), act.file_name)


@router.post("/{act_id}/share")
async def share(act_id: uuid.UUID, db: Db, current_user: CurrentUser):
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    if act.status != "ready":
        raise HTTPException(409, "Студенту можно открыть только готовый PDF")
    if not act.shared_at:
        act.shared_at = datetime.now(timezone.utc)
        await log_change(db, "student", act.student_id, "act_shared_to_portal", None, str(act.id), str(current_user.id))
        await db.commit()
    return _act_dict(act)


@router.post("/{act_id}/send")
async def send(act_id: uuid.UUID, body: ActMailInput, db: Db, current_user: CurrentUser):
    require_access(current_user, "acts_mail", Action.manage)
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    if act.status != "ready" or not act.storage_path:
        raise HTTPException(409, "Сначала сформируйте PDF")
    existing = await db.get(ActMailAttempt, body.request_id)
    if existing:
        if existing.act_id != act.id or existing.recipient != str(body.recipient) or existing.subject != body.subject or existing.body != body.body:
            raise HTTPException(409, "Идентификатор отправки уже использован для другого письма")
        return _mail_dict(existing)
    unresolved = (await db.execute(select(ActMailAttempt.id).where(ActMailAttempt.act_id == act.id,
        ActMailAttempt.status.in_(["sending", "unknown"])).limit(1))).first()
    if unresolved:
        raise HTTPException(409, "Предыдущая отправка ещё выполняется или её результат неизвестен. Проверьте почтовый ящик перед повторной отправкой.")
    if not mailer.is_configured():
        raise HTTPException(503, "Корпоративная почта ещё не подключена")
    content = await minio_download(act.storage_path)
    attempt = ActMailAttempt(id=body.request_id, act_id=act.id, sent_by=current_user.id,
        recipient=str(body.recipient), subject=body.subject, body=body.body, status="sending")
    db.add(attempt)
    await db.commit()  # Retain intent before the external side effect; never auto-retry it.
    try:
        attempt.message_id = await mailer.send_pdf(to=attempt.recipient, subject=attempt.subject,
            text=attempt.body, content=content, filename=act.file_name)
        attempt.status = "sent"
    except (mailer.MailNotConfigured, smtplib.SMTPRecipientsRefused, smtplib.SMTPAuthenticationError):
        attempt.status = "failed"
    except Exception:
        attempt.status = "unknown"  # Server may already have accepted the message.
    attempt.finished_at = datetime.now(timezone.utc)
    await log_change(db, "student", act.student_id, "act_mail_" + attempt.status,
        None, str(act.id), str(current_user.id))
    await db.commit()
    return _mail_dict(attempt)


@router.post("/{act_id}/mail/{attempt_id}/resolve")
async def resolve_mail(act_id: uuid.UUID, attempt_id: uuid.UUID, body: ActMailResolution,
                       db: Db, current_user: CurrentUser):
    require_access(current_user, "acts_mail", Action.manage)
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    attempt = await db.get(ActMailAttempt, attempt_id)
    if attempt is None or attempt.act_id != act.id:
        raise HTTPException(404, "Отправка не найдена")
    if attempt.status not in ("unknown", "sending"):
        raise HTTPException(409, "Результат этой отправки уже определён")
    # A sender may still be running. Never unlock the act while it can finish.
    if attempt.status == "sending" and (datetime.now(timezone.utc) - attempt.created_at).total_seconds() < 300:
        raise HTTPException(409, "Отправка ещё может выполняться. Повторите проверку через 5 минут.")
    old = attempt.status
    attempt.status = "confirmed_sent" if body.outcome == "sent" else "failed"
    attempt.finished_at = datetime.now(timezone.utc)
    await log_change(db, "student", act.student_id, "act_mail_manually_resolved", old,
        f"{attempt.id}: {attempt.status}; {body.note}", str(current_user.id))
    await db.commit()
    return _mail_dict(attempt)


@router.get("/portal/mine")
async def portal_acts(student: CurrentStudent, db: Db):
    rows = (await db.execute(select(ServiceAct).where(ServiceAct.student_id == student.id,
        ServiceAct.status == "ready", ServiceAct.shared_at.is_not(None)).order_by(ServiceAct.created_at.desc()))).scalars().all()
    return [_act_dict(a, snapshot=False) for a in rows]


@router.get("/portal/{act_id}/pdf")
async def portal_pdf(act_id: uuid.UUID, student: CurrentStudent, db: Db):
    act = await db.get(ServiceAct, act_id)
    if act is None or act.student_id != student.id or act.status != "ready" or not act.shared_at or not act.storage_path:
        raise HTTPException(404, "Акт не найден")
    return _pdf_response(await minio_download(act.storage_path), act.file_name)
