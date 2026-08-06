from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import log_change
from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.contract import Contract
from app.models.contract_addendum import AddendumStatus, ContractAddendum
from app.models.student import Student
from app.models.student_task import StudentTask, TaskStatus
from app.models.user import UserRole

router = APIRouter(prefix="/contract-addenda", tags=["contract_addenda"])


def _staff(user) -> None:
    if user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Доступ только для персонала")


def _business_day(value: date, count: int) -> date:
    current = value
    remaining = count
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def _to_dict(a: ContractAddendum) -> dict:
    return {
        "id": str(a.id),
        "contract_id": str(a.contract_id),
        "student_id": str(a.student_id),
        "number": a.number,
        "reason": a.reason,
        "current_intake": a.current_intake,
        "new_intake": a.new_intake,
        "country_name": a.country_name,
        "programs": a.programs or [],
        "transfer_start": a.transfer_start.isoformat() if a.transfer_start else None,
        "transfer_end": a.transfer_end.isoformat() if a.transfer_end else None,
        "resume_date": a.resume_date.isoformat() if a.resume_date else None,
        "contract_expires_at": a.contract_expires_at.isoformat() if a.contract_expires_at else None,
        "related_service_ids": a.related_service_ids or [],
        "related_task_ids": a.related_task_ids or [],
        "status": a.status.value,
        "version": a.version,
        "document_hash": a.document_hash,
        "customer_signed_by": str(a.customer_signed_by) if a.customer_signed_by else None,
        "customer_signed_at": a.customer_signed_at.isoformat() if a.customer_signed_at else None,
        "company_signed_by": str(a.company_signed_by) if a.company_signed_by else None,
        "company_signed_at": a.company_signed_at.isoformat() if a.company_signed_at else None,
        "created_at": a.created_at.isoformat(),
    }


@router.get("/student/{student_id}")
async def list_addenda(
    student_id: uuid.UUID,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    if current_user.role not in (UserRole.admin, UserRole.mzk_manager, UserRole.mentor, UserRole.student):
        raise HTTPException(status_code=403, detail="Access denied")
    student = await db.get(Student, student_id)
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")
    if current_user.role == UserRole.student and student.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    result = await db.execute(
        select(ContractAddendum).where(ContractAddendum.student_id == student_id).order_by(ContractAddendum.created_at.desc())
    )
    return [_to_dict(item) for item in result.scalars().all()]


@router.post("", status_code=201)
async def create_addendum(
    body: dict,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    _staff(current_user)
    try:
        contract_id = uuid.UUID(body["contract_id"])
        student_id = uuid.UUID(body["student_id"])
    except (KeyError, ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Неверный contract_id или student_id")
    contract = await db.get(Contract, contract_id)
    if not contract or contract.student_id != student_id:
        raise HTTPException(status_code=404, detail="Договор не найден у этого студента")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Причина переноса обязательна")
    number = (body.get("number") or "").strip()
    if not number:
        raise HTTPException(status_code=422, detail="Номер соглашения обязателен")
    existing = await db.execute(select(ContractAddendum.id).where(ContractAddendum.number == number))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Соглашение с таким номером уже существует")

    def parse_date(key: str):
        try:
            return date.fromisoformat(body[key]) if body.get(key) else None
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Неверная дата: {key}")

    addendum = ContractAddendum(
        contract_id=contract_id,
        student_id=student_id,
        number=number,
        reason=reason,
        current_intake=body.get("current_intake"),
        new_intake=body.get("new_intake"),
        country_name=body.get("country_name"),
        programs=body.get("programs") or [],
        transfer_start=parse_date("transfer_start"),
        transfer_end=parse_date("transfer_end"),
        resume_date=parse_date("resume_date"),
        contract_expires_at=parse_date("contract_expires_at"),
        related_service_ids=body.get("related_service_ids") or [],
        related_task_ids=body.get("related_task_ids") or [],
        created_by=current_user.id,
    )
    db.add(addendum)
    await db.flush()
    await log_change(db, "contract_addendum", addendum.id, "created", None, addendum.number, str(current_user.id))
    await db.commit()
    return _to_dict(addendum)


@router.post("/{addendum_id}/send")
async def send_addendum(addendum_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _staff(current_user)
    addendum = await db.get(ContractAddendum, addendum_id)
    if not addendum:
        raise HTTPException(status_code=404, detail="Соглашение не найдено")
    if addendum.status != AddendumStatus.draft:
        raise HTTPException(status_code=409, detail="Отправить можно только черновик")
    addendum.status = AddendumStatus.sent_to_customer
    await db.commit()
    return _to_dict(addendum)


@router.post("/{addendum_id}/sign/customer")
async def sign_customer(addendum_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    addendum = await db.get(ContractAddendum, addendum_id)
    if not addendum:
        raise HTTPException(status_code=404, detail="Соглашение не найдено")
    student = await db.get(Student, addendum.student_id)
    if current_user.role == UserRole.student and student and student.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role != UserRole.student and current_user.role not in (UserRole.admin, UserRole.mzk_manager):
        raise HTTPException(status_code=403, detail="Подписать может заказчик или персонал от его имени")
    if addendum.status not in (AddendumStatus.sent_to_customer, AddendumStatus.draft):
        raise HTTPException(status_code=409, detail="Соглашение нельзя подписать в текущем статусе")
    addendum.customer_signed_by = current_user.id
    addendum.customer_signed_at = datetime.now(timezone.utc)
    addendum.status = AddendumStatus.customer_signed
    await db.commit()
    return _to_dict(addendum)


@router.post("/{addendum_id}/sign/company")
async def sign_company(addendum_id: uuid.UUID, current_user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]):
    _staff(current_user)
    result = await db.execute(select(ContractAddendum).where(ContractAddendum.id == addendum_id))
    addendum = result.scalar_one_or_none()
    if not addendum:
        raise HTTPException(status_code=404, detail="Соглашение не найдено")
    if addendum.status != AddendumStatus.customer_signed:
        raise HTTPException(status_code=409, detail="Сначала нужна подпись заказчика")
    payload = _to_dict(addendum)
    addendum.company_signed_by = current_user.id
    addendum.company_signed_at = datetime.now(timezone.utc)
    addendum.status = AddendumStatus.active
    addendum.document_hash = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()

    # Контрольные точки периода возобновления создаются один раз и привязываются
    # к соглашению через related_task_ids для последующего аудита.
    task_ids = list(addendum.related_task_ids or [])
    if addendum.resume_date and not task_ids:
        due_dates = (
            ("Актуализировать профиль, shortlist, стратегию и roadmap", 10),
            ("Проверить документы заказчика после возобновления", 5),
            ("Согласовать альтернативы после переноса", 3),
        )
        for title, days in due_dates:
            task = StudentTask(
                student_id=addendum.student_id,
                task_text=title,
                expected_result=f"Контрольная точка соглашения {addendum.number}",
                priority="high",
                created_by=current_user.id,
                status=TaskStatus.open,
                due_date=_business_day(addendum.resume_date, days),
                original_due_date=_business_day(addendum.resume_date, days),
                due_date_set_by=current_user.id,
            )
            db.add(task)
            await db.flush()
            task_ids.append(str(task.id))
        addendum.related_task_ids = task_ids
    await db.commit()
    return _to_dict(addendum)
