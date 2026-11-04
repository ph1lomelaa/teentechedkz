from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.uploads import read_upload_capped
from app.services.contract_documents import read_pages, signing_date, preserve_manual, apply_document_signing_date
from app.services.contract_profile import cached_profile, extract_profile, store_profile
from app.services.minio_service import minio_upload, minio_download, minio_delete
from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.student import Student
from app.models.guardian import Guardian
from app.models.contract import Contract
from app.models.service_act import ServiceAct
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole
from app.models.trustme_contract import TrustMeContractLink, TrustMeDocument
from app.services.mentor_scope import require_student_access
from app.services.trustme import (
    TrustMeChallengeRequired, TrustMeClient, TrustMeError, TrustMeSessionExpired,
)

router = APIRouter(prefix="/trustme/students", tags=["trustme"])
Db = Annotated[AsyncSession, Depends(get_db)]


class SearchRequest(BaseModel):
    query: str = Field(default="", max_length=500)
    mode: Literal["name", "text", "auto"] = "auto"
    aliases: list[str] = Field(default_factory=list, max_length=6)


class LinkRequest(BaseModel):
    short_url: str = Field(pattern=r"^[A-Za-z0-9_-]{6,64}$")
    identity_confirmed: bool


async def _student(db: AsyncSession, student_id: uuid.UUID, user, *, manage=False):
    require_access(user, "contracts", Action.manage if manage else Action.view)
    if user.role == UserRole.mentor:
        assigned = (await db.execute(select(MentorAssignment.id).where(
            MentorAssignment.student_id == student_id, MentorAssignment.mentor_id == user.id,
            MentorAssignment.is_active.is_(True), MentorAssignment.assignment_status == "active").limit(1))).first()
        if not assigned:
            raise HTTPException(404, "Студент не найден")
    await require_student_access(db, student_id, user)
    student = await db.get(Student, student_id)
    if student is None:
        raise HTTPException(404, "Студент не найден")
    return student


def _client():
    try:
        return TrustMeClient.from_settings()
    except ValueError as error:
        raise HTTPException(503, str(error),
                            headers={"X-Error-Code": "TRUSTME_NOT_CONFIGURED"}) from None


def _upstream(error: TrustMeError):
    if isinstance(error, TrustMeChallengeRequired):
        code = "TRUSTME_CHALLENGE_REQUIRED"
    elif isinstance(error, TrustMeSessionExpired):
        code = "TRUSTME_SESSION_EXPIRED"
    else:
        code = "TRUSTME_UNAVAILABLE"
    return HTTPException(503, str(error), headers={"X-Error-Code": code})


def _signers(parties: list, field: str) -> list[dict]:
    result = []
    for party in parties:
        if not isinstance(party, dict):
            continue
        try:
            values = json.loads(party.get(field) or "[]")
        except (ValueError, TypeError):
            values = []
        if not isinstance(values, list):
            values = []
        fields = {x.get("key"): x.get("value") for x in values
                  if isinstance(x, dict) and isinstance(x.get("key"), str)}
        name = fields.get("fio") or fields.get("name")
        result.append({"name": name if isinstance(name, str) else None,
                       "signed": party.get("signed") is True,
                       "is_company": party.get("isCreator", party.get("is_creator")) is True})
    return result


def _candidate(row: dict) -> dict:
    short_url = row.get("shortUrl")
    # Never construct a client-facing arbitrary URL from an upstream response.
    try:
        TrustMeClient._validate_short_url(short_url or "")
    except (ValueError, TypeError):
        short_url = None
    return {"external_id": row.get("id"), "short_url": short_url,
            "name": row.get("contractName"), "number": row.get("numberDeal"),
            "status": row.get("contractStatus"), "created_at": row.get("createdAt"),
            "signers": _signers(row.get("signers") or [], "jsonData")}


def _link_dict(link: TrustMeContractLink) -> dict:
    fields = (cached_profile(link) or {}).get("fields", {})
    return {"customer_name": fields.get("customer_name"), "student_name": fields.get("student_name"), "legal_number": fields.get("contract_number"), "contract_date": fields.get("contract_date"), "id": str(link.id), "short_url": link.short_url, "name": link.name,
            "number": link.number, "status": link.status, "signers": link.signers,
            "financial_contract_id": str(link.financial_contract_id) if getattr(link, "financial_contract_id", None) else None,
            "created_at": link.contract_created_at, "linked_at": link.linked_at.isoformat(),
            "source": getattr(link, "source", None) or "trustme",
            "signed_date": getattr(link, "signed_date", None),
            "signed_date_source": getattr(link, "signed_date_source", None)}


@router.get("/{student_id}/links")
async def list_links(student_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user)
    links = (await db.execute(select(TrustMeContractLink).where(
        TrustMeContractLink.student_id == student_id).order_by(
            TrustMeContractLink.linked_at.desc()))).scalars().all()
    return [_link_dict(link) for link in links]


@router.post("/{student_id}/search")
async def search_contracts(student_id: uuid.UUID, body: SearchRequest, db: Db, current_user: CurrentUser):
    student = await _student(db, student_id, current_user, manage=True)
    if any(len(x) > 500 for x in body.aliases):
        raise HTTPException(422, "Вариант имени не должен превышать 500 символов")
    if body.mode == "text" and not body.query.strip():
        raise HTTPException(422, "Укажите название или номер договора")
    if body.mode == "auto" and not body.query.strip():
        raise HTTPException(422, "Укажите данные договора")
    if body.mode == "auto" and "://" in body.query:
        candidate = await resolve_contract(student_id, ResolveRequest(reference=body.query), db, current_user)
        return {"candidates": [candidate], "queries": [], "truncated": False}
    guardians = (await db.execute(select(Guardian.full_name).where(Guardian.student_id == student_id))).scalars().all()
    aliases = tuple(dict.fromkeys([*body.aliases, *[name for name in guardians if name]]))[:6] if body.mode == "name" else ()
    try:
        async with _client() as client:
            result = await client.search(body.query.strip() or student.full_name,
                                         aliases, max_pages=3, exact=body.mode in ("text", "auto"))
        return {"candidates": [_candidate(x) for x in result.candidates],
                "queries": result.queries, "truncated": result.truncated}
    except TrustMeError as error:
        raise _upstream(error) from None
    except ValueError:
        raise HTTPException(422, "Укажите имя для поиска") from None


@router.post("/{student_id}/links")
async def link_contract(student_id: uuid.UUID, body: LinkRequest, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    if not body.identity_confirmed:
        raise HTTPException(422, "Подтвердите, что договор относится к этому студенту")
    try:
        async with _client() as client:
            data = await client.contract(body.short_url)
            company_id = client.company_id
    except TrustMeError as error:
        raise _upstream(error) from None
    if data.get("contract_status") == 4:
        raise HTTPException(409, "Договор отозван компанией")
    external_id = data.get("id")
    if not isinstance(external_id, str) or not external_id:
        raise HTTPException(502, "TrustMe не вернул идентификатор договора")
    existing = (await db.execute(select(TrustMeContractLink).where(
        TrustMeContractLink.company_id == company_id,
        TrustMeContractLink.external_id == external_id))).scalar_one_or_none()
    if existing:
        if existing.student_id != student_id:
            raise HTTPException(409, "Этот договор уже привязан к другой карточке")
        return _link_dict(existing)
    link = TrustMeContractLink(
        student_id=student_id, company_id=company_id, external_id=external_id,
        short_url=body.short_url, name=data.get("contract_name") or "Договор TrustMe",
        number=data.get("number_deal"), status=data["contract_status"],
        signers=_signers(data.get("doc_parties") or [], "requisites"),
        contract_created_at=data.get("created_at"), linked_by=current_user.id,
        signed_date=signing_date(data), signed_date_source="trustme" if signing_date(data) else None,
    )
    db.add(link)
    try:
        await db.flush()
        await log_change(db, "student", student_id, "trustme_contract_linked", None,
                         body.short_url, str(current_user.id))
        result = _link_dict(link)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Договор уже привязан; обновите список") from None
    return result


@router.delete("/{student_id}/links/{link_id}", status_code=204)
async def unlink_contract(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.id == link_id).with_for_update())).scalar_one_or_none()
    if not link or link.student_id != student_id:
        raise HTTPException(404, "Привязка не найдена")
    await _guard_ready_acts(db, link.id)
    await log_change(db, "student", student_id, "trustme_contract_unlinked",
                     link.short_url, None, str(current_user.id))
    await db.delete(link)
    await db.commit()


@router.get("/{student_id}/pdf/{short_url}")
async def contract_pdf(student_id: uuid.UUID, short_url: str, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    try:
        async with _client() as client:
            content = await client.pdf(short_url)
    except TrustMeError as error:
        raise _upstream(error) from None
    except ValueError:
        raise HTTPException(422, "Некорректный идентификатор договора") from None
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": 'attachment; filename="TrustMe-contract.pdf"',
        "Cache-Control": "no-store",
    })


class FinancialAssignment(BaseModel):
    financial_contract_id: uuid.UUID | None


async def _guard_ready_acts(db, link_id):
    if (await db.execute(select(ServiceAct.id).where(ServiceAct.contract_link_id == link_id,
            ServiceAct.status == "ready").limit(1))).first():
        raise HTTPException(409, "У договора есть готовые акты: перенос или удаление связи запрещены")


@router.patch("/{student_id}/links/{link_id}/financial-contract")
async def assign_financial_contract(student_id: uuid.UUID, link_id: uuid.UUID,
                                    body: FinancialAssignment, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = (await db.execute(select(TrustMeContractLink).where(
        TrustMeContractLink.id == link_id).with_for_update())).scalar_one_or_none()
    if link is None or link.student_id != student_id:
        raise HTTPException(404, "Привязка не найдена")
    if body.financial_contract_id == link.financial_contract_id:
        return _link_dict(link)
    if body.financial_contract_id:
        contract = await db.get(Contract, body.financial_contract_id)
        if contract is None or contract.student_id != student_id:
            raise HTTPException(422, "Финансовый договор должен принадлежать тому же студенту")
    # Initial assignment of existing documents is allowed; moving a ready act is not.
    if link.financial_contract_id is not None:
        await _guard_ready_acts(db, link.id)
    old = str(link.financial_contract_id) if link.financial_contract_id else None
    link.financial_contract_id = body.financial_contract_id
    await log_change(db, "student", student_id, "trustme_financial_contract_assigned", old,
                     str(body.financial_contract_id) if body.financial_contract_id else None, str(current_user.id))
    await db.commit()
    return _link_dict(link)


class ResolveRequest(BaseModel):
    reference: str = Field(min_length=6, max_length=300)


def contract_reference(reference: str) -> str:
    reference = reference.strip()
    if "://" in reference:
        parsed = urlparse(reference)
        if parsed.scheme != "https" or parsed.hostname not in {"trustme.kz", "test.trustme.kz"} or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError("Укажите ссылку на договор trustme.kz")
        reference = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    TrustMeClient._validate_short_url(reference)
    return reference


@router.post("/{student_id}/resolve")
async def resolve_contract(student_id: uuid.UUID, body: ResolveRequest, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    try:
        short_url = contract_reference(body.reference)
        async with _client() as client:
            info = await client.contract(short_url)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except TrustMeError as error:
        raise _upstream(error) from None
    return {"external_id": info.get("id"), "short_url": short_url, "name": info.get("contract_name") or "Договор TrustMe",
            "number": info.get("number_deal"), "status": info.get("contract_status"),
            "created_at": info.get("created_at"), "signed_date": signing_date(info),
            "signers": _signers(info.get("doc_parties") or [], "requisites")}


async def _owned_link(db, sid, lid):
    link = (await db.execute(select(TrustMeContractLink).where(TrustMeContractLink.id == lid).with_for_update())).scalar_one_or_none()
    if link is None or link.student_id != sid:
        raise HTTPException(404, "Договор не найден")
    return link


@router.post("/{student_id}/upload", status_code=201)
async def upload_contract(student_id: uuid.UUID, db: Db, current_user: CurrentUser,
                          file: UploadFile = File(...), name: str = Form(..., min_length=1, max_length=500),
                          identity_confirmed: bool = Form(False), signed_confirmed: bool = Form(False)):
    await _student(db, student_id, current_user, manage=True)
    if not identity_confirmed or not name.strip():
        raise HTTPException(422, "Укажите название и подтвердите принадлежность договора студенту")
    content = await read_upload_capped(file, 30_000_000)
    try:
        pages = await asyncio.to_thread(read_pages, content)
        profile = extract_profile(pages, {}, content)
    except Exception:
        raise HTTPException(422, "Не удалось открыть PDF. Нужен файл без пароля, не более 80 страниц") from None
    fingerprint = hashlib.sha256(content).hexdigest()
    existing = (await db.execute(select(TrustMeContractLink).where(
        TrustMeContractLink.company_id == "manual", TrustMeContractLink.external_id == fingerprint))).scalar_one_or_none()
    if existing:
        if existing.student_id != student_id:
            raise HTTPException(409, "Этот PDF уже привязан к другому студенту. Проверьте документ")
        return _link_dict(existing)
    link = TrustMeContractLink(student_id=student_id, company_id="manual", external_id=fingerprint,
        short_url=uuid.uuid4().hex, name=name.strip(), source="manual", status=3 if signed_confirmed else 0,
        signers=[], linked_by=current_user.id, profile_checked_at=datetime.now(timezone.utc))
    apply_document_signing_date(link, pages)
    store_profile(link, profile)
    path = await minio_upload(content, student_id, "contract.pdf", "application/pdf")
    link.storage_path = path
    try:
        db.add(link)
        await db.flush()
        await log_change(db, "student", student_id, "manual_contract_uploaded", None,
                         f"{link.id}; signed_confirmed={signed_confirmed}", str(current_user.id))
        await db.commit()
    except Exception as error:
        await db.rollback()
        await minio_delete(path)
        if isinstance(error, IntegrityError):
            raise HTTPException(409, "Этот PDF уже загружен; обновите список договоров") from None
        raise
    return _link_dict(link)


@router.post("/{student_id}/links/{link_id}/inspect")
async def inspect_link(student_id: uuid.UUID, link_id: uuid.UUID, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = await _owned_link(db, student_id, link_id)
    from app.api.v1.endpoints.acts import _refresh_contract
    previous = cached_profile(link)
    try:
        info = await _refresh_contract(db, link)
        if link.source == "manual":
            content = await minio_download(link.storage_path)
        else:
            async with _client() as client:
                content = await client.pdf(link.short_url)
        pages = await asyncio.to_thread(read_pages, content)
        apply_document_signing_date(link, pages)
        profile = preserve_manual(extract_profile(pages, info, content), previous)
        store_profile(link, profile)
    except TrustMeError as error:
        raise _upstream(error) from None
    except (ValueError, OSError):
        raise HTTPException(422, "Не удалось прочитать PDF. Откройте оригинал и заполните реквизиты вручную") from None
    await db.commit()
    return {**{k:v for k,v in profile.items() if k != "source_pages"}, "status": link.status, "pages": pages, "signed_date": link.signed_date,
            "signed_date_source": link.signed_date_source, "signers": link.signers}


class DetailsRequest(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    contract_number: str = Field(default="", max_length=100)
    contract_date: date | None = None
    signed_date: date | None = None
    customer_name: str = Field(default="", max_length=300)
    student_name: str = Field(default="", max_length=300)
    signed_confirmed: bool | None = None


@router.patch("/{student_id}/links/{link_id}/details")
async def update_details(student_id: uuid.UUID, link_id: uuid.UUID, body: DetailsRequest, db: Db, current_user: CurrentUser):
    await _student(db, student_id, current_user, manage=True)
    link = await _owned_link(db, student_id, link_id)
    if not body.name.strip():
        raise HTTPException(422, "Укажите название договора")
    if body.signed_date and body.signed_date > date.today():
        raise HTTPException(422, "Дата подписания не может быть в будущем")
    if link.signed_date_source == "trustme" and (body.signed_date.isoformat() if body.signed_date else None) != link.signed_date:
        raise HTTPException(409, "Дата подтверждена TrustMe и не может быть изменена вручную")
    profile = cached_profile(link) or extract_profile([], {}, b"")
    for key in ("contract_number", "contract_date", "customer_name", "student_name"):
        value = getattr(body, key)
        value = value.isoformat() if isinstance(value, date) else (value or "").strip()
        if profile["fields"].get(key, "") != value:
            profile["fields"][key] = value
            profile["sources"][key] = {"kind": "manual", "page": None, "excerpt": "Проверено сотрудником"}
            profile["conflicts"].pop(key, None)
    profile["missing"] = [k for k in ("student_name","customer_name","executor_name","executor_representative","executor_basis","contract_number","contract_date","city") if not profile["fields"].get(k)]
    store_profile(link, profile)
    link.name = body.name.strip()
    incoming_date = body.signed_date.isoformat() if body.signed_date else None
    if link.signed_date_source != "trustme" and incoming_date != link.signed_date:
        link.signed_date = incoming_date
        link.signed_date_source = "manual" if body.signed_date else None
    if link.source == "manual" and body.signed_confirmed is not None:
        if not body.signed_confirmed:
            await _guard_ready_acts(db, link.id)
        link.status = 3 if body.signed_confirmed else 0
        link.signers = [{"name": body.customer_name.strip() or None, "is_company": False, "signed": body.signed_confirmed}]
    await log_change(db, "student", student_id, "contract_details_updated", None, str(link.id), str(current_user.id))
    await db.commit()
    return _link_dict(link)


def new_document_link(student_id, company_id, info, candidate, profile, pages, choices, linked_by):
    """Запись о подписанном договоре TrustMe, проверенном по тексту PDF."""
    dates = {profile['fields'].get('contract_date'), signing_date(info)} - {None}
    financial = [c for c in choices if c.signed_date and c.signed_date.isoformat() in dates]
    link = TrustMeContractLink(student_id=student_id, company_id=company_id,
        external_id=info['id'], short_url=candidate['short_url'], name=info.get('contract_name') or candidate['name'],
        number=info.get('number_deal'), status=3, source='trustme', financial_contract_id=financial[0].id if len(financial) == 1 else None,
        signers=_signers(info.get('doc_parties') or [], 'requisites'), contract_created_at=info.get('created_at'),
        signed_date=signing_date(info), signed_date_source='trustme' if signing_date(info) else None,
        linked_by=linked_by, profile_checked_at=datetime.now(timezone.utc))
    apply_document_signing_date(link, pages)
    store_profile(link, profile)
    return link


@router.post("/{student_id}/auto-link")
async def auto_link_contracts(student_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """No global scan: discover only this student's contracts, once per hour."""
    from redis.asyncio import Redis
    from redis.exceptions import RedisError
    from app.core.config import settings
    from app.core.encryption import encrypt, decrypt
    from app.services.contract_discovery import name_overlap, phone_key, phones_in_pages, likely_candidate, match_student, same_person
    student = await _student(db, student_id, current_user, manage=True)
    guardian_rows = (await db.execute(select(Guardian).where(Guardian.student_id == student_id))).scalars().all()
    guardians = [g.full_name for g in guardian_rows]
    phones = list(dict.fromkeys([student.phone, *[g.phone for g in guardian_rows]]))
    identity = hashlib.sha256(json.dumps([student.full_name, phones, sorted(guardians)], ensure_ascii=False).encode()).hexdigest()[:20]
    key = f"contract-discovery:v4:{student_id}:{identity}"
    token = uuid.uuid4().hex
    async with Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=2, socket_timeout=2) as redis:
        try:
            saved = await redis.get(key)
            if saved:
                return json.loads(decrypt(saved))
            if not await redis.set(key+":lock", token, nx=True, ex=120):
                return {"state": "pending", "linked_ids": [], "review": []}
        except RedisError:
            raise HTTPException(503, "Автопоиск временно недоступен. Договор можно загрузить вручную") from None
        cache_report = False
        report = {"state": "complete", "linked_ids": [], "review": [], "checked_at": datetime.now(timezone.utc).isoformat(), "partial": False}
        try:
            async with asyncio.timeout(85):
                async with _client() as client:
                    names = list(dict.fromkeys([student.full_name, *guardians]))
                    # Порядок по надёжности: телефон из карточки, полное ФИО студента и
                    # родителей, и только если ничего не нашлось — части имени (много шума).
                    found, by_phone = {}, set()
                    for phone in phones[:3]:
                        if not phone_key(phone):
                            continue
                        extra = await client.search(phone_key(phone), max_pages=2, exact=True)
                        found.update({row['id']: row for row in extra.candidates})
                        by_phone.update(row['id'] for row in extra.candidates)
                        report['partial'] = report['partial'] or extra.truncated
                    for name in names[:7]:
                        extra = await client.search(name, max_pages=2, exact=True)
                        found.update({row['id']: row for row in extra.candidates})
                        report['partial'] = report['partial'] or extra.truncated
                    if not any(row.get('contractStatus') == 3 for row in found.values()):
                        extra = await client.search(student.full_name, tuple(guardians)[:6], max_pages=2)
                        found.update({row['id']: row for row in extra.candidates})
                        report['partial'] = report['partial'] or extra.truncated
                    rows = sorted(found.values(), key=lambda row: (row['id'] not in by_phone, not likely_candidate(row, names)))
                    # Неподписанные тоже показываем — но только на подтверждение, без автопривязки.
                    # Отозванные (статус 4) не предлагаем.
                    signed = sorted((row for row in rows if row.get('contractStatus') != 4), key=lambda row: row.get('contractStatus') != 3)
                    all_names = (await db.execute(select(Student.full_name))).scalars().all()
                    choices = (await db.execute(select(Contract).where(Contract.student_id == student_id))).scalars().all()
                    for row in signed[:12]:
                        candidate = _candidate(row)
                        if not candidate['short_url']:
                            continue
                        existing = (await db.execute(select(TrustMeContractLink).where(
                            TrustMeContractLink.company_id == client.company_id,
                            TrustMeContractLink.external_id == row.get('id')))).scalar_one_or_none()
                        if existing and existing.student_id == student_id:
                            continue
                        info = await client.contract(candidate['short_url'])
                        if info.get('contract_status') == 4:
                            continue
                        is_signed = info.get('contract_status') == 3
                        try:
                            content = await client.pdf(candidate['short_url'])
                            # OCR is a review case; unattended matching relies on the
                            # document's actual text, not a possibly misread name.
                            pages = await asyncio.to_thread(read_pages, content, ocr=False)
                            profile = extract_profile(pages, info, content)
                        except TrustMeError as error:
                            if isinstance(error, (TrustMeChallengeRequired, TrustMeSessionExpired)):
                                raise
                            report['partial'] = True
                            if likely_candidate(row, names):
                                report['review'].append({**candidate, 'reason': 'Не удалось загрузить PDF для автоматической проверки'})
                            continue
                        except (ValueError, OSError):
                            if likely_candidate(row, names):
                                report['review'].append({**candidate, 'reason': 'Нужно проверить оригинал PDF'})
                            continue
                        outcome, reason = match_student(student, profile, pages, all_names, phones)
                        if outcome == 'unrelated':
                            continue
                        if outcome != 'confirmed':
                            fields = profile['fields']
                            related = (row['id'] in by_phone or any(same_person(fields.get('customer_name') or '', n) for n in names)
                                       or bool(phones_in_pages(pages) & {phone_key(p) for p in phones})
                                       or name_overlap(fields.get('student_name') or '', student.full_name) >= 2)
                            if not (likely_candidate(row, names) or related):
                                continue
                        if existing:
                            # «Подтвердить» здесь всё равно получила бы 409 — объясняем сразу.
                            owner = await db.get(Student, existing.student_id)
                            report['review'].append({**candidate, 'blocked': True, 'reason':
                                f'Договор уже привязан к карточке «{owner.full_name if owner else "другого студента"}». Если это ошибка — отвяжите его там'})
                            continue
                        if outcome != 'confirmed' or not is_signed:
                            report['review'].append({**candidate, 'reason': reason if is_signed else f'Не подписан · {reason}'})
                            continue
                        link = new_document_link(student_id, client.company_id, info, candidate, profile, pages, choices, current_user.id)
                        try:
                            async with db.begin_nested():
                                db.add(link)
                                await db.flush()
                                await log_change(db, 'student', student_id, 'contract_auto_linked', None, str(link.id), str(current_user.id))
                        except IntegrityError:
                            continue
                        report['linked_ids'].append(str(link.id))
                    if len(signed) > 12:
                        report['partial'] = True
                    # Реестр мог найти договор по телефону или ИИН родителя, когда поиск
                    # по ФИО его не видит (другое написание фамилии). Показываем и его.
                    shown = {c.get('short_url') for c in report['review']}
                    for doc in (await db.execute(select(TrustMeDocument).where(
                            TrustMeDocument.company_id == client.company_id, TrustMeDocument.decision == 'review',
                            TrustMeDocument.link_id.is_(None)))).scalars():
                        if str(student_id) in (doc.candidate_ids or []) and doc.short_url not in shown and doc.status != 4:
                            candidate = _candidate({'id': doc.external_id, 'shortUrl': doc.short_url, 'contractName': doc.name,
                                                    'numberDeal': doc.number, 'contractStatus': doc.status, 'createdAt': doc.contract_created_at})
                            if candidate['short_url']:
                                report['review'].append({**candidate, 'reason': doc.reason or 'Найден при сверке реестра договоров'})
                await db.commit()
                cache_report = True
        except (TrustMeError, HTTPException, TimeoutError) as error:
            # Earlier confirmed documents can be committed even if the provider
            # stops responding later; retries remain idempotent.
            await db.commit()
            cache_report = True
            report['state'] = 'unavailable'
            report['message'] = error.detail if isinstance(error, HTTPException) else str(error) or 'TrustMe не ответил вовремя'
        except Exception:
            await db.rollback()
            report.update(state='unavailable', linked_ids=[])
            raise HTTPException(503, 'Не удалось завершить автоматическую проверку договоров') from None
        finally:
            try:
                if cache_report:
                    await redis.set(key, encrypt(json.dumps(report, ensure_ascii=False)), ex=60 if report['state'] == 'unavailable' else 3600)
                await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key+':lock', token)
            except RedisError:
                pass
        return report
