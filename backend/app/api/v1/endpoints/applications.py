from __future__ import annotations
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser, CurrentStudent
from app.models.application import Application, SubmissionStatus, VisaStatus
from app.models.student import Student
from app.models.university import University
from app.models.user import UserRole
from app.schemas.application import ApplicationCreate, ApplicationUpdate, StudentApplicationOut
from app.services.country_flags import attach_flags
from app.services.mentor_scope import require_student_access

# Без префикса: этот файл обслуживает и /applications, и /portal/applications —
# та же идиома, что в student_universities.py.
router = APIRouter(tags=["applications"])

STAFF = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)


async def _assert_manage(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    """Заявками студента управляет только персонал в своём скоупе.

    Раньше здесь была функция `_can_edit`, которая вычисляла список
    подопечных, но не использовала его: первая же ветка пропускала любого
    ментора, поэтому ментор мог править и удалять заявки ЛЮБОГО студента.
    Теперь скоуп проверяется тем же require_student_access, что и везде.

    Студент сюда не попадает вовсе: свои заявки он только читает.
    """
    if user.role not in STAFF:
        raise HTTPException(status_code=403, detail="Access denied")
    await require_student_access(db, student_id, user)


async def _assert_read(db: AsyncSession, student_id: uuid.UUID, user) -> None:
    """Читать заявки может персонал в скоупе или сам студент."""
    if user.role == UserRole.student:
        res = await db.execute(select(Student.id).where(Student.user_id == user.id))
        if res.scalar_one_or_none() != student_id:
            # 404, а не 403 — чтобы нельзя было перебором узнать чужие id.
            raise HTTPException(status_code=404, detail="Студент не найден")
        return
    await _assert_manage(db, student_id, user)


async def _resolve_university(db: AsyncSession, university_id: uuid.UUID | None) -> University | None:
    if university_id is None:
        return None
    uni = await db.get(University, university_id)
    if not uni:
        raise HTTPException(status_code=404, detail="Университет не найден")
    return uni


@router.get("/students/{student_id}/applications")
async def list_student_applications(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Заявки студента для CRM и воркспейса."""
    await _assert_read(db, student_id, current_user)
    apps = await _load_for_student(db, student_id)
    await attach_flags(db, [a.university_ref for a in apps if a.university_ref])
    return {"items": [_app_to_dict(a) for a in apps]}


@router.get("/portal/applications", response_model=list[StudentApplicationOut])
async def my_applications(
    student: CurrentStudent,
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Собственные заявки студента.

    До этого студент не видел свой процесс поступления вообще: заявки читались
    только вложенными в GET /students/{id}, а это CRM-эндпоинт.
    """
    apps = await _load_for_student(db, student.id)
    await attach_flags(db, [a.university_ref for a in apps if a.university_ref])
    return apps


async def _load_for_student(db: AsyncSession, student_id: uuid.UUID) -> list[Application]:
    result = await db.execute(
        select(Application).where(Application.student_id == student_id)
    )
    # created_at у модели нет, поэтому «основная» первой, дальше по стране —
    # стабильный порядок вместо произвольного из БД.
    return sorted(
        result.scalars().unique().all(),
        key=lambda a: (not a.is_primary, (a.country or "").lower()),
    )


@router.post("/applications")
async def create_application(
    body: ApplicationCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    await _assert_manage(db, body.student_id, current_user)
    uni = await _resolve_university(db, body.university_id)

    app = Application(
        student_id=body.student_id,
        contract_id=body.contract_id,
        country=body.country.strip(),
        # Если вуз выбран из справочника, а текст не задан — подставляем имя,
        # чтобы старые экраны, читающие только строку, не показывали пусто.
        university=body.university or (uni.name if uni else None),
        university_id=body.university_id,
        program=body.program,
        deadline=body.deadline,
        submissions_planned=body.submissions_planned,
        submissions_done=0,
        submission_status=body.submission_status,
        visa_status=body.visa_status,
        scholarship_target=body.scholarship_target,
        is_primary=body.is_primary,
        lead_mentor_id=body.lead_mentor_id,
    )
    db.add(app)
    await db.commit()
    await db.refresh(app)
    return _app_to_dict(app)


@router.patch("/applications/{app_id}")
async def update_application(
    app_id: uuid.UUID,
    body: ApplicationUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Application).where(Application.id == app_id))
    app = result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Подача не найдена")

    await _assert_manage(db, app.student_id, current_user)

    updates = body.model_dump(exclude_unset=True)
    if "university_id" in updates:
        uni = await _resolve_university(db, updates["university_id"])
        # Привязали вуз, а текст пустой — заполняем именем из справочника.
        if uni and not (updates.get("university") or app.university):
            updates["university"] = uni.name

    for field in ["country", "university", "university_id", "program", "deadline", "scholarship_target",
                  "is_primary", "submissions_planned", "submissions_done", "submission_status",
                  "visa_status", "lead_mentor_id", "contract_id"]:
        if field in updates:
            setattr(app, field, updates[field])

    await db.commit()
    await db.refresh(app)
    return _app_to_dict(app)


@router.delete("/applications/{app_id}")
async def delete_application(
    app_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    result = await db.execute(select(Application).where(Application.id == app_id))
    app = result.scalar_one_or_none()
    if not app:
        raise HTTPException(status_code=404, detail="Подача не найдена")
    # Скоуп проверяем после загрузки: иначе ментор мог удалить заявку чужого
    # студента, зная только её id.
    await _assert_manage(db, app.student_id, current_user)
    await db.delete(app)
    await db.commit()
    return {"message": "Deleted"}


def _app_to_dict(a: Application) -> dict:
    uni = getattr(a, "university_ref", None)
    return {
        "id": str(a.id),
        "student_id": str(a.student_id),
        "contract_id": str(a.contract_id) if a.contract_id else None,
        "country": a.country,
        "university": a.university,
        "university_id": str(a.university_id) if a.university_id else None,
        # Разворачиваем вуз, чтобы карточка могла нарисовать фото и ссылку,
        # не подтягивая весь каталог ради join на клиенте.
        "university_ref": {
            "id": str(uni.id),
            "name": uni.name,
            "country_name": uni.country_name,
            "city": uni.city,
            "photo_url": uni.photo_url,
            "country_flag_emoji": getattr(uni, "country_flag_emoji", None),
            # Справочный дедлайн вуза — ориентир на карточке, когда у самой
            # заявки дата ещё не проставлена.
            "deadline_note": uni.deadline_note,
        } if uni else None,
        "program": a.program,
        "deadline": a.deadline.isoformat() if a.deadline else None,
        "submissions_planned": a.submissions_planned,
        "submissions_done": a.submissions_done,
        "submission_status": a.submission_status.value,
        "visa_status": a.visa_status.value if a.visa_status else None,
        "scholarship_target": a.scholarship_target,
        "is_primary": a.is_primary,
        "lead_mentor_id": str(a.lead_mentor_id) if a.lead_mentor_id else None,
    }
