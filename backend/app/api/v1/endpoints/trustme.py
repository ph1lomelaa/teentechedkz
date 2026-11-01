from __future__ import annotations

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.student import Student
from app.models.contract import Contract
from app.models.service_act import ServiceAct
from app.models.mentor_assignment import MentorAssignment
from app.models.user import UserRole
from app.models.trustme_contract import TrustMeContractLink
from app.services.mentor_scope import require_student_access
from app.services.trustme import (
    TrustMeChallengeRequired, TrustMeClient, TrustMeError, TrustMeSessionExpired,
)

router = APIRouter(prefix="/trustme/students", tags=["trustme"])
Db = Annotated[AsyncSession, Depends(get_db)]


class SearchRequest(BaseModel):
    query: str = Field(default="", max_length=500)
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
    except ValueError:
        raise HTTPException(503, "Настройте TRUSTME_LOGIN и TRUSTME_PASSWORD на сервере",
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
    return {"id": str(link.id), "short_url": link.short_url, "name": link.name,
            "number": link.number, "status": link.status, "signers": link.signers,
            "financial_contract_id": str(link.financial_contract_id) if getattr(link, "financial_contract_id", None) else None,
            "created_at": link.contract_created_at, "linked_at": link.linked_at.isoformat()}


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
    try:
        async with _client() as client:
            result = await client.search(body.query.strip() or student.full_name,
                                         tuple(body.aliases), max_pages=2)
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
    if data.get("contract_status") != 3:
        raise HTTPException(409, "Для актов выберите договор, подписанный обеими сторонами")
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
