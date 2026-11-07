from __future__ import annotations

import asyncio
from collections import defaultdict
import json
import logging
import re
import smtplib
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.trustme import _client, _signers, _upstream, _link_dict
from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentStudent, CurrentUser
from app.core.permissions import Action, require_access
from app.models.application import Application, SubmissionStatus
from app.models.contract import Contract
from app.models.guardian import Guardian
from app.models.meeting import Meeting, MeetingStatus
from app.models.mentor_assignment import MentorAssignment
from app.models.service_act import ActMailAttempt, ServiceAct
from app.models.student import Student
from app.models.trustme_contract import TrustMeContractLink
from app.models.user import User, UserRole
from app.schemas.service_act import ActInput, ActDraftInput, ActMailInput, ActMailResolution
from app.services import mailer
from app.services.act_pdf import render_act
from app.services.contract_services import validate_service_lines, validate_company_signature, extract_services, with_default_services
from app.services.contract_documents import read_pages, signing_date, apply_document_signing_date
from app.services.contract_discovery import same_person
from app.services.contract_profile import cached_profile, extract_profile, store_profile, FIELDS, EXTRACTOR
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
              "act_date": row.snapshot.get("act_date") or "", "created_at": row.created_at.isoformat(),
              "shared": row.shared_at is not None, "supersedes_id": str(row.supersedes_id) if row.supersedes_id else None}
    result["created_by"] = str(row.created_by) if getattr(row, "created_by", None) else None
    if snapshot:
        result["snapshot"] = row.snapshot
    return result


def _pdf_response(content, name, *, inline=False):
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="act.pdf"; filename*=UTF-8\'\'{quote(name)}',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


async def _link(db, sid, link_id, *, lock=True):
    # Блокировка нужна только тем, кто меняет договор. Чтение (предпросмотр, черновик, PDF)
    # иначе ждёт, пока другой запрос держит строку на время обращения к TrustMe.
    stmt = select(TrustMeContractLink).where(TrustMeContractLink.id == link_id)
    link = (await db.execute(stmt.with_for_update() if lock else stmt)).scalar_one_or_none()
    if link is None or link.student_id != sid:
        raise HTTPException(404, "Привязанный договор не найден")
    return link


STATUS_FRESH = timedelta(minutes=15)


async def _verify_contract(link):
    if getattr(link, "source", None) == "manual":
        if not link.storage_path:
            raise HTTPException(409, "Загрузите файл договора")
        return
    checked = getattr(link, "profile_checked_at", None)
    if checked and datetime.now(timezone.utc) - checked < STATUS_FRESH:
        # Статус проверен при открытии панели — не ждём TrustMe ещё раз.
        if link.status == 4:
            raise HTTPException(409, "Договор отозван компанией")
        return
    try:
        async with _client() as client:
            data = await client.contract(link.short_url)
            if client.company_id != link.company_id or data.get("id") != link.external_id:
                raise HTTPException(409, "Привязка договора не соответствует подключённой компании")
    except TrustMeError:
        # TrustMe недоступен — опираемся на последний известный статус договора.
        logging.getLogger(__name__).warning("TrustMe unavailable, using cached status for link %s", link.id)
        data = {"contract_status": link.status}
    if data.get("contract_status") == 4:
        raise HTTPException(409, "Договор отозван компанией")


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


@router.get("/table")
async def acts_table(db: Db, current_user: CurrentUser):
    """Таблица «Договоры и акты»: все видимые студенты сразу — поиск, фильтры и
    сортировка на клиенте, как в «Пайплайне». Ментор видит только своих."""
    require_access(current_user, "acts", Action.view)
    from app.services.act_coverage import SERVICE_COLUMNS, SERVICE_LABELS, coverage
    from app.services.student_work_status import load_work_statuses
    stmt = select(Student).where(Student.is_archived.is_(False))
    if current_user.role == UserRole.mentor:
        stmt = stmt.where(Student.id.in_(_assignment(current_user)))
    students = (await db.execute(stmt.order_by(Student.full_name, Student.id))).scalars().all()
    ids = [s.id for s in students]
    covered = await coverage(db, ids)
    statuses = await load_work_statuses(db, ids)
    people = defaultdict(list)
    for sid, mentor_id, name, role in (await db.execute(select(MentorAssignment.student_id, MentorAssignment.mentor_id, User.name, MentorAssignment.role)
            .join(User, User.id == MentorAssignment.mentor_id).where(MentorAssignment.student_id.in_(ids),
            MentorAssignment.is_active.is_(True), MentorAssignment.assignment_status == "active"))).all():
        people[sid].append({"id": str(mentor_id), "name": name, "role": getattr(role, "value", role)})
    mzk = {}
    for sid, user_id, name in (await db.execute(select(Contract.student_id, Contract.mzk_manager_id, User.name)
            .join(User, User.id == Contract.mzk_manager_id).where(Contract.student_id.in_(ids))
            .order_by(Contract.created_at))).all():
        mzk[sid] = {"id": str(user_id), "name": name}
    await db.commit()  # состав услуг старых договоров, посчитанный один раз
    me = str(current_user.id)
    return {"columns": [{"key": c, "label": SERVICE_LABELS[c]} for c in SERVICE_COLUMNS], "rows": [{
        "student_id": str(s.id), "full_name": s.full_name, "phone": s.phone,
        "status": statuses.get(s.id, {}).get("pipeline_status"),
        "intake": s.intake_year, "degree": getattr(s.degree_level, "value", s.degree_level),
        "responsibles": people[s.id], "mzk": mzk.get(s.id),
        "mine": any(p["id"] == me for p in people[s.id]) or (mzk.get(s.id) or {}).get("id") == me,
        **covered[s.id]} for s in students]}


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
        "contracts": [_link_dict(c) for c in links],
        "acts": [{**_act_dict(a), "author_name": authors.get(a.created_by),
                  "mail": [_mail_dict(m) for m in attempts if m.act_id == a.id]} for a in acts]}


@router.get("/students/{student_id}/contracts/{link_id}/pdf")
async def contract_pdf(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user)
    return await _link_pdf(await _link(db, student_id, link_id, lock=False))


async def _link_pdf(link):
    if getattr(link, "source", None) == "manual":
        if not link.storage_path:
            raise HTTPException(404, "PDF договора не найден")
        return _pdf_response(await minio_download(link.storage_path), "Договор.pdf", inline=True)
    try:
        async with _client() as client:
            if client.company_id != link.company_id:
                raise HTTPException(409, "Договор относится к другой компании")
            content = await client.pdf(link.short_url)
    except TrustMeError as error:
        raise _upstream(error) from None
    return _pdf_response(content, f"Договор - {link.short_url}.pdf", inline=True)


def _extract_pages(content):
    return read_pages(content)


async def _refresh_contract(db, link):
    if getattr(link, "source", None) == "manual":
        link.profile_checked_at = datetime.now(timezone.utc)
        return {}
    async with _client() as client:
        if client.company_id != link.company_id:
            raise HTTPException(409, "Договор относится к другой компании")
        info = await client.contract(link.short_url)
    status = info.get("contract_status")
    if not isinstance(status, int) or isinstance(status, bool):
        raise TrustMeError("TrustMe не вернул актуальный статус договора")
    value = signing_date(info)
    if value:
        link.signed_date, link.signed_date_source = value, "trustme"
    link.status = status
    link.signers = _signers(info.get("doc_parties") or [], "requisites")
    link.profile_checked_at = datetime.now(timezone.utc)
    return info


@router.post("/students/{student_id}/contracts/{link_id}/status")
async def check_contract(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user)
    link = await _link(db, student_id, link_id)
    stale = False
    try:
        await _refresh_contract(db, link)
    except TrustMeError:
        # Не блокируем работу с актами: показываем последний известный статус.
        await db.rollback()
        link = await _link(db, student_id, link_id, lock=False)
        stale = True
    else:
        await db.commit()
    checked = link.profile_checked_at
    return {"status": link.status, "stale": stale, "checked_at": checked.isoformat() if checked else None, "signed_date": getattr(link, "signed_date", None), "signed_date_source": getattr(link, "signed_date_source", None)}


def _inspection_fallback(previous, link):
    if previous:
        if previous.get('source_pages') and previous.get('fingerprint'):
            services = extract_services(previous['source_pages'], previous['fingerprint'])
            known = {s['id'] for s in services}
            services.extend(s for s in previous.get('services', []) if s.get('verbatim_manual') and s['id'] not in known)
            previous['services'] = services
            with_default_services(previous)
        return previous, 'Не удалось обновить договор. Используются ранее сохранённые данные; проверьте реквизиты по оригиналу.'
    # No PDF is claimed as read: this identity is tied to the linked document,
    # and only shared standard services are available until extraction succeeds.
    identity = f"document-reference:{link.id}".encode()
    profile = extract_profile([], {}, identity)
    profile['extractor'] = 0
    profile['fingerprint_kind'] = 'document_reference'
    return profile, 'Не удалось прочитать PDF. Доступны стандартные услуги; реквизиты и дату подписания проверьте и заполните по оригиналу договора.'


@router.post("/students/{student_id}/contracts/{link_id}/inspect")
async def inspect_contract(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser,
                           refresh: bool = False):
    student = await _student(db, student_id, current_user, manage=True)
    link = await _link(db, student_id, link_id)
    previous = cached_profile(link)
    pages = []
    warning = None
    try:
        if previous and previous.get('service_policy') == 3 and 'source_pages' in previous and previous.get('extractor', 1) >= EXTRACTOR and not refresh:
            profile = previous
        else:
            info = await _refresh_contract(db, link)
            if getattr(link, "source", None) == "manual":
                content = await minio_download(link.storage_path)
            else:
                async with _client() as client:
                    if client.company_id != link.company_id:
                        raise HTTPException(409, "Договор относится к другой компании")
                    content = await client.pdf(link.short_url)
            pages = await asyncio.to_thread(_extract_pages, content)
            apply_document_signing_date(link, pages)
            profile = extract_profile(pages, info, content)
            if previous and previous.get('fingerprint') == profile.get('fingerprint'):
                known = {item['id'] for item in profile['services']}
                profile['services'].extend(item for item in previous.get('services',[]) if item.get('verbatim_manual') and item['id'] not in known)
            # Explicit staff corrections survive a later extraction refresh.
            for key, source in (previous or {}).get("sources", {}).items():
                if source.get("kind") == "manual" and key in previous.get("fields", {}):
                    profile["fields"][key] = previous["fields"][key]
                    profile["sources"][key] = source
                    profile["conflicts"].pop(key, None)
            profile["missing"] = [key for key in profile["missing"] if not profile["fields"].get(key)]
            store_profile(link, profile)
    except TrustMeError:
        profile, warning = _inspection_fallback(previous, link)
        store_profile(link, profile)
    except Exception as error:
        if isinstance(error, HTTPException): raise
        logging.getLogger(__name__).exception("Contract inspection failed for link %s", link.id)
        profile, warning = _inspection_fallback(previous, link)
        store_profile(link, profile)
    fields = profile["fields"]
    if not fields.get("student_name") and fields.get("customer_name") and same_person(fields["customer_name"], student.full_name):
        # Договор заключён самим студентом: отдельной строки «Абитуриент» нет.
        fields["student_name"] = fields["customer_name"]
        profile["sources"]["student_name"] = {**profile["sources"].get("customer_name", {}), "excerpt": "Заказчик — сам студент"}
        profile["missing"] = [key for key in profile["missing"] if key != "student_name"]
    await db.commit()
    # Сумма для акта — из финансового договора; без явной связи берём его,
    # только если у студента он единственный.
    finance = (await db.execute(select(Contract).where(Contract.student_id == student_id))).scalars().all()
    finance = [c for c in finance if c.id == link.financial_contract_id] if link.financial_contract_id else finance if len(finance) == 1 else []
    amount = finance[0] if finance and finance[0].amount else None
    return {**{k:v for k,v in profile.items() if k != "source_pages"}, "pages": pages or profile.get("source_pages", []), "status": link.status, "warning": warning,
            "signed_date": getattr(link, "signed_date", None), "signed_date_source": getattr(link, "signed_date_source", None),
            "contract_amount": str(amount.amount) if amount else None, "contract_currency": amount.currency if amount else None,
            "suggested_contract_number": profile["fields"].get("contract_number"),
            "signers": link.signers, "requires_verification": True,
            "applications": [{"id":str(a.id),"university":a.university,"program":a.program,"status":a.submission_status.value} for a in (await db.execute(select(Application).where(Application.student_id == student_id, Application.contract_id == link.financial_contract_id if link.financial_contract_id else True))).scalars().all()]}


class ContractRequisitesPatch(BaseModel):
    fields: dict[str, str] = Field(max_length=13)

    @field_validator("fields")
    @classmethod
    def valid_fields(cls, values):
        from datetime import date as Date
        from pydantic import TypeAdapter, EmailStr
        if set(values) - set(FIELDS):
            raise ValueError("Неизвестное поле реквизитов")
        result = {}
        for key,value in values.items():
            value = value.strip()
            maximum = 1500 if key == "executor_requisites" else 500 if key == "executor_name" else 300
            if len(value) > maximum: raise ValueError("Поле реквизитов слишком длинное")
            if key == "contract_date" and value: Date.fromisoformat(value)
            if key == "customer_email" and value: TypeAdapter(EmailStr).validate_python(value)
            result[key] = value
        return result


@router.patch("/students/{student_id}/contracts/{link_id}/profile")
async def save_contract_profile(student_id: uuid.UUID, link_id: uuid.UUID, body: ContractRequisitesPatch,
                                db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = await _link(db, student_id, link_id)
    profile = cached_profile(link)
    if profile is None:
        profile = {"parser_version": 1, "fields": {}, "sources": {}, "conflicts": {}, "service_hints": {}, "missing": [], "reviewed": False}
    changed = []
    for key,value in body.fields.items():
        if profile["fields"].get(key, "") != value:
            profile["fields"][key] = value
            profile["sources"][key] = {"kind": "manual", "page": None, "excerpt": "Дополнено сотрудником"}
            profile["conflicts"].pop(key, None)
            changed.append(key)
    profile["missing"] = [key for key in profile.get("missing", []) if not profile["fields"].get(key)]
    store_profile(link, profile)
    if changed:
        await log_change(db, "student", student_id, "contract_requisites_updated", None,
                         ", ".join(changed), str(current_user.id))
    await db.commit()
    return {"saved": True}


async def _validate_input(db, sid, data, *, lock=False):
    link = await _link(db, sid, data.contract_link_id, lock=lock)
    if data.supersedes_id:
        previous = await db.get(ServiceAct, data.supersedes_id)
        if previous is None or previous.student_id != sid or previous.status != "ready":
            raise HTTPException(422, "Нельзя заменить этот акт")
    return link


@router.post("/students/{student_id}/preview")
async def preview(student_id: uuid.UUID, body: ActInput, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = await _validate_input(db, student_id, body)
    try:
        validate_service_lines(body, cached_profile(link))
        validate_company_signature(body, cached_profile(link))
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    await _check_work_evidence(db, student_id, body, link)
    await _check_duplicate_work(db, student_id, body)
    content = await asyncio.to_thread(render_act, body, draft=True)
    return _pdf_response(content, body.filename(), inline=True)


@router.post("/students/{student_id}", status_code=201)
async def create_draft(student_id: uuid.UUID, body: ActDraftInput, db: Db, current_user: CurrentUser):
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
async def update_draft(act_id: uuid.UUID, body: ActDraftInput, db: Db, current_user: CurrentUser):
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


@router.delete("/{act_id}", status_code=204)
async def delete_act(act_id: uuid.UUID, db: Db, current_user: CurrentUser):
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    attempts = (await db.execute(select(ActMailAttempt).where(ActMailAttempt.act_id == act_id))).scalars().all()
    if any(m.status in {"sending", "unknown"} for m in attempts):
        raise HTTPException(409, "Сначала уточните результат отправки письма")
    replacement = (await db.execute(select(ServiceAct.id).where(ServiceAct.supersedes_id == act_id))).first()
    if replacement:
        raise HTTPException(409, "Сначала удалите новую версию этого акта")
    await log_change(db, "student", act.student_id, "act_deleted", str(act.id), None, str(current_user.id))
    await db.delete(act)
    await db.commit()
    return Response(status_code=204)


@router.post("/{act_id}/generate")
async def generate(act_id: uuid.UUID, db: Db, current_user: CurrentUser):
    act = await _act(db, act_id, current_user, manage=True, lock=True)
    if act.status == "ready":
        return _act_dict(act)
    try:
        data = ActInput.model_validate(act.snapshot)
    except ValidationError:
        raise HTTPException(422, "Дополните недостающие реквизиты, период и выполненные услуги перед созданием PDF") from None
    try:
        data.require_verified()
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    link = await _validate_input(db, act.student_id, data, lock=True)
    await _verify_contract(link)
    try:
        validate_service_lines(data, cached_profile(link))
        validate_company_signature(data, cached_profile(link))
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    await _check_work_evidence(db, act.student_id, data, link)
    await _check_duplicate_work(db, act.student_id, data)
    content = await asyncio.to_thread(render_act, data)
    act.snapshot = data.model_dump(mode="json")
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


# Ученик видит свой договор только для чтения: реквизиты сторон, услуги и
# сумму. Внутренние пометки разбора (источники, конфликты) не отдаются.
PORTAL_CONTRACT_FIELDS = ("contract_number", "contract_date", "city", "customer_name", "student_name", "executor_name")


@router.get("/portal/contracts")
async def portal_contracts(student: CurrentStudent, db: Db):
    links = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.student_id == student.id,
        TrustMeContractLink.status != 4).order_by(TrustMeContractLink.linked_at.desc()))).scalars().all()
    finance = {c.id: c for c in (await db.execute(select(Contract).where(Contract.student_id == student.id))).scalars()}
    out = []
    for link in links:
        profile = cached_profile(link) or {}
        fields = profile.get("fields", {})
        money = finance.get(link.financial_contract_id) if link.financial_contract_id else (next(iter(finance.values())) if len(finance) == 1 else None)
        out.append({"id": str(link.id), "status": link.status, "source": getattr(link, "source", None) or "trustme",
                    "signed_date": getattr(link, "signed_date", None),
                    "fields": {k: fields.get(k) for k in PORTAL_CONTRACT_FIELDS if fields.get(k)},
                    "services": [{"name": x.get("name"), "text": x.get("text")} for x in profile.get("services", []) if x.get("name")],
                    "amount": str(money.amount) if money and money.amount is not None else None,
                    "currency": money.currency if money else None})
    return out


@router.get("/portal/contracts/{link_id}/pdf")
async def portal_contract_pdf(link_id: uuid.UUID, student: CurrentStudent, db: Db):
    link = await db.get(TrustMeContractLink, link_id)
    if link is None or link.student_id != student.id or link.status == 4:
        raise HTTPException(404, "Договор не найден")
    return await _link_pdf(link)


class ContractQuote(BaseModel):
    page: int = Field(ge=1, le=80)
    text: str = Field(min_length=12)
    category: Literal['profile','portfolio','ielts','career','csca','entrance','sat','applications','offer','admission','other'] = 'other'


@router.post('/students/{student_id}/contracts/{link_id}/service-quote')
async def add_service_quote(student_id: uuid.UUID, link_id: uuid.UUID, body: ContractQuote, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = await _link(db, student_id, link_id)
    profile = cached_profile(link)
    from app.services.contract_services import normalized
    import hashlib
    page = next((p for p in (profile or {}).get('source_pages',[]) if p['page'] == body.page), None)
    quote = normalized(body.text)
    if not page or quote not in normalized(page['text']):
        raise HTTPException(422, 'Цитата не найдена на указанной странице договора. Скопируйте точный текст из PDF')
    for existing in profile.get('services',[]):
        if existing['page'] == body.page and (quote in normalized(existing.get('excerpt','')) or quote in normalized(existing['text'])):
            return existing
    identity = hashlib.sha256(f"{profile['fingerprint']}:{body.page}:{quote}".encode()).hexdigest()[:24]
    from app.services.act_coverage import SERVICE_LABELS
    item = {'id':identity, 'name':SERVICE_LABELS.get(body.category, 'Услуга по договору'), 'category':body.category, 'text':quote,
            'page':body.page, 'reference':f'Договор, стр. {body.page}', 'excerpt':quote, 'verbatim_manual': True}
    if not any(s['id'] == identity for s in profile.get('services',[])):
        profile.setdefault('services',[]).append(item)
        store_profile(link, profile)
        await log_change(db, 'student', student_id, 'contract_service_quote_added', None, identity, str(current_user.id))
        await db.commit()
    return item


async def _check_work_evidence(db, sid, data, link):
    data.verified_outcomes = []
    # Результат (подача/оффер/зачисление) необязателен: услуги до оффера — это
    # процесс, а не итог. Если сотрудник отметил заявки, они должны подтвердиться.
    if data.template not in ('applications','offer','admission','final') or not data.application_ids:
        return
    allowed = [SubmissionStatus.submitted,SubmissionStatus.offer_received,SubmissionStatus.enrolled] if data.template == 'applications' else [SubmissionStatus.offer_received,SubmissionStatus.enrolled] if data.template == 'offer' else [SubmissionStatus.enrolled]
    stmt = select(Application).where(Application.student_id == sid, Application.id.in_(data.application_ids), Application.submission_status.in_(allowed))
    if link.financial_contract_id:
        stmt = stmt.where(Application.contract_id == link.financial_contract_id)
    applications = (await db.execute(stmt)).scalars().all()
    if not applications or len(applications) != len(set(data.application_ids)):
        raise HTTPException(422, 'Выберите подтверждённый оффер или зачисление из заявок этого студента и договора')
    for application in applications:
        if not application.university:
            raise HTTPException(422, 'Укажите университет в подтверждающей заявке')
        label = 'Заявка подана' if data.template == 'applications' else 'Оффер получен' if application.submission_status == SubmissionStatus.offer_received else 'Зачисление подтверждено'
        data.verified_outcomes.append(f"{label}: {application.university or 'университет не указан'}" + (f", {application.program}" if application.program else ''))


async def _check_duplicate_work(db, sid, data):
    ready = (await db.execute(select(ServiceAct).where(ServiceAct.student_id == sid, ServiceAct.contract_link_id == data.contract_link_id, ServiceAct.status == 'ready'))).scalars().all()
    replaced = {a.supersedes_id for a in ready if a.supersedes_id}
    selected = {line.contract_service_id for line in data.lines}
    for previous in ready:
        if previous.id in replaced or previous.id == data.supersedes_id:
            continue
        old = {line.get('contract_service_id') for line in previous.snapshot.get('lines',[]) if line.get('contract_service_id')}
        if old & selected:
            raise HTTPException(409, 'Эта работа уже включена в готовый акт. Для исправления создайте новую версию этого акта')
    data.previous_act_references = [f"Акт от {a.snapshot.get('act_date') or a.created_at.date().isoformat()}" for a in ready if a.id not in replaced and a.id != data.supersedes_id]
