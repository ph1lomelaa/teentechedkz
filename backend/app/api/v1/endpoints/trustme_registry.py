"""Реестр договоров TrustMe: то, что синхронизация не смогла привязать сама.

Автопривязка срабатывает только при однозначном совпадении; остальные договоры
лежат в trustme_documents с причиной и кандидатами. Здесь сотрудник видит их
списком и привязывает к нужной карточке или отмечает «не студент».
"""
from __future__ import annotations

import asyncio
import json
import uuid
from collections import Counter
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.trustme import _client, _student, _upstream
from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.encryption import decrypt
from app.core.permissions import Action, require_access
from app.models.student import Student
from app.models.trustme_contract import TrustMeContractLink, TrustMeDocument
from app.models.user import UserRole
from app.services.contract_documents import read_pages
from app.services.contract_profile import extract_profile
from app.services.trustme import TrustMeError
from app.services.trustme_sync import _link

router = APIRouter(prefix="/trustme/registry", tags=["trustme"])
Db = Annotated[AsyncSession, Depends(get_db)]
OPEN = ("review", "unmatched", "unreadable")


def _require(user):
    require_access(user, "contracts", Action.manage)
    if user.role == UserRole.mentor:
        # Реестр общий для всей компании — ментору чужие договоры не показываем.
        raise HTTPException(403, "Реестр договоров доступен управлению")


def _facts(doc):
    try:
        return json.loads(decrypt(doc.facts_encrypted)).get("fields", {}) if doc.facts_encrypted else {}
    except Exception:
        return {}


async def _open_doc(db, doc_id):
    doc = await db.get(TrustMeDocument, doc_id)
    if doc is None:
        raise HTTPException(404, "Договор не найден в реестре")
    return doc


@router.get("")
async def list_registry(db: Db, current_user: CurrentUser):
    _require(current_user)
    docs = (await db.execute(select(TrustMeDocument))).scalars().all()
    counts = Counter(d.decision for d in docs)
    # Сначала «на проверку» — у них уже есть кандидаты, привязка в один клик.
    pending = sorted((d for d in docs if d.decision in OPEN and d.link_id is None),
                     key=lambda d: (OPEN.index(d.decision), d.contract_created_at or ""))
    ids = {uuid.UUID(c) for d in pending for c in d.candidate_ids or []}
    names = dict((await db.execute(select(Student.id, Student.full_name).where(Student.id.in_(ids)))).all()) if ids else {}
    items = []
    for d in pending:
        facts = _facts(d)
        items.append({"id": str(d.id), "number": d.number, "name": d.name, "decision": d.decision, "reason": d.reason,
                      "status": d.status, "created_at": d.contract_created_at, "checked_at": d.checked_at.isoformat(),
                      "student_name": facts.get("student_name"), "customer_name": facts.get("customer_name"),
                      "candidates": [{"id": c, "full_name": names[uuid.UUID(c)]} for c in d.candidate_ids or [] if uuid.UUID(c) in names]})
    return {"counts": dict(counts), "items": items}


@router.get("/{doc_id}/pdf")
async def registry_pdf(doc_id: uuid.UUID, db: Db, current_user: CurrentUser):
    _require(current_user)
    doc = await _open_doc(db, doc_id)
    if not doc.short_url:
        raise HTTPException(404, "У договора нет ссылки TrustMe")
    try:
        async with _client() as client:
            content = await client.pdf(doc.short_url)
    except TrustMeError as error:
        raise _upstream(error) from None
    return Response(content, media_type="application/pdf", headers={"Cache-Control": "no-store"})


class LinkBody(BaseModel):
    student_id: uuid.UUID


@router.post("/{doc_id}/link")
async def link_registry(doc_id: uuid.UUID, body: LinkBody, db: Db, current_user: CurrentUser):
    _require(current_user)
    student = await _student(db, body.student_id, current_user, manage=True)
    doc = await _open_doc(db, doc_id)
    existing = (await db.execute(select(TrustMeContractLink).where(
        TrustMeContractLink.company_id == doc.company_id, TrustMeContractLink.external_id == doc.external_id))).scalar_one_or_none()
    if existing:
        if existing.student_id != student.id:
            raise HTTPException(409, "Договор уже привязан к другой карточке")
        doc.decision, doc.reason, doc.link_id = "linked", None, existing.id
        await db.commit()
        return {"link_id": str(existing.id)}
    if not doc.short_url:
        raise HTTPException(422, "У договора нет ссылки TrustMe")
    try:
        async with _client() as client:
            info = await client.contract(doc.short_url)
            if info.get("contract_status") != 3:
                raise HTTPException(409, "Договор ещё не подписан обеими сторонами")
            content = await client.pdf(doc.short_url)
            pages = await asyncio.to_thread(read_pages, content, ocr=False)
            link = await _link(db, client, doc, student, info, extract_profile(pages, info, content), pages, current_user.id)
            await db.commit()
    except TrustMeError as error:
        await db.rollback()
        raise _upstream(error) from None
    except (ValueError, OSError):
        await db.rollback()
        raise HTTPException(422, "Не удалось прочитать PDF договора") from None
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Договор уже привязан; обновите список") from None
    return {"link_id": str(link.id)}


@router.post("/{doc_id}/dismiss")
async def dismiss_registry(doc_id: uuid.UUID, db: Db, current_user: CurrentUser):
    """Договор не про студента (сотрудник, партнёр, тест) — убрать из очереди.
    Синхронизация пропускает такие договоры, как и вручную отвязанные."""
    _require(current_user)
    doc = await _open_doc(db, doc_id)
    if doc.link_id:
        raise HTTPException(409, "Договор уже привязан")
    doc.decision, doc.reason = "detached", "Отмечено сотрудником: не относится к студентам"
    await log_change(db, "trustme_document", doc.id, "trustme_document_dismissed", None, doc.number, str(current_user.id))
    await db.commit()
    return {"ok": True}
