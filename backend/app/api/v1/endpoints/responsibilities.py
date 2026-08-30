"""Зоны ответственности: кто ведёт какой участок у конкретного ученика.

Раздел отвечает на вопрос, которого в системе не было: «кто ведёт встречи именно
у этого ученика». Роль отвечает на другой вопрос — «кому вообще можно», — и
подменять одно другим нельзя; см. докстринг models/student_responsibility.py.

Ответственность ничего не запрещает. Здесь только раздают и читают таблички с
именами; ни один другой эндпоинт на них не смотрит при проверке доступа.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.student import Student
from app.models.student_responsibility import ResponsibilityArea, StudentResponsibility
from app.models.user import User, UserRole
from app.services.mentor_scope import mentor_assigned_student_ids, require_student_access

router = APIRouter(prefix="/responsibilities", tags=["responsibilities"])

# Порядок показа задаётся здесь один раз — и бэкендом, и фронтом. Иначе зоны
# на разных экранах выстроятся по-разному, и матрицу станет невозможно читать
# глазами по строкам.
AREA_ORDER: tuple[ResponsibilityArea, ...] = tuple(ResponsibilityArea)

# Кого вообще можно назначить ответственным. Студент исключён: кабинет — это не
# рабочая роль, участок на него не вешается.
ASSIGNABLE_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)


def _row(item: StudentResponsibility) -> dict:
    return {
        "area": item.area.value,
        "user_id": str(item.user_id),
        "user_name": item.user.name if item.user else None,
        "user_role": item.user.role.value if item.user else None,
        "assigned_at": item.assigned_at.isoformat() if item.assigned_at else None,
        "note": item.note,
    }


def _coverage(assigned: dict[str, dict]) -> dict:
    """Покрытие зон — тем же приёмом, что team_readiness в students.py:145.

    Пустая зона это не ошибка, а вопрос без ответа: именно их и надо видеть,
    иначе «кто ведёт встречи» так и останется без ответа, просто молча.
    """
    covered = [area.value for area in AREA_ORDER if area.value in assigned]
    missing = [area.value for area in AREA_ORDER if area.value not in assigned]
    return {
        "total": len(AREA_ORDER),
        "covered": len(covered),
        "covered_areas": covered,
        "missing_areas": missing,
        "is_complete": not missing,
    }


async def _load(db: AsyncSession, student_id: uuid.UUID) -> dict[str, dict]:
    result = await db.execute(
        select(StudentResponsibility)
        .options(selectinload(StudentResponsibility.user))
        .where(StudentResponsibility.student_id == student_id)
    )
    return {item.area.value: _row(item) for item in result.scalars().all()}


def _parse_area(area: str) -> ResponsibilityArea:
    try:
        return ResponsibilityArea(area)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Неизвестная зона: {area}")


@router.get("/areas")
async def list_areas(current_user: CurrentUser):
    """Словарь зон. Один источник порядка и состава для всех экранов."""
    require_access(current_user, "responsibilities", Action.view)
    return {"areas": [area.value for area in AREA_ORDER]}


@router.get("/mine")
async def my_responsibilities(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """За что отвечаю я — для «Моего дня».

    Ключевой запрос всего раздела: он превращает «где-то я за что-то отвечаю» в
    конкретный список. Идёт по индексу (user_id).
    """
    require_access(current_user, "responsibilities", Action.view)
    result = await db.execute(
        select(StudentResponsibility)
        .options(selectinload(StudentResponsibility.student))
        .where(StudentResponsibility.user_id == current_user.id)
    )
    items = result.scalars().all()
    by_area: dict[str, list[dict]] = {}
    for item in items:
        by_area.setdefault(item.area.value, []).append({
            "student_id": str(item.student_id),
            "student_name": item.student.full_name if item.student else None,
        })
    return {
        "areas": [
            {"area": area.value, "students": by_area.get(area.value, [])}
            for area in AREA_ORDER
            if by_area.get(area.value)
        ],
        "total_students": len({item.student_id for item in items}),
    }


@router.get("/students/{student_id}")
async def student_responsibilities(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Все зоны ученика — и занятые, и пустые."""
    require_access(current_user, "responsibilities", Action.view)
    await require_student_access(db, student_id, current_user)

    assigned = await _load(db, student_id)
    return {
        "student_id": str(student_id),
        "areas": [
            assigned.get(area.value, {"area": area.value, "user_id": None, "user_name": None,
                                      "user_role": None, "assigned_at": None, "note": None})
            for area in AREA_ORDER
        ],
        "coverage": _coverage(assigned),
    }


@router.put("/students/{student_id}/{area}")
async def assign_responsibility(
    student_id: uuid.UUID,
    area: str,
    body: dict,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Назначить ответственного за зону. Повторный вызов заменяет предыдущего."""
    require_access(current_user, "responsibilities", Action.manage)
    await require_student_access(db, student_id, current_user)
    parsed = _parse_area(area)

    if not await db.get(Student, student_id):
        raise HTTPException(status_code=404, detail="Студент не найден")

    raw_user_id = body.get("user_id")
    if not raw_user_id:
        raise HTTPException(status_code=422, detail="Укажите user_id")
    try:
        user_id = uuid.UUID(str(raw_user_id))
    except ValueError:
        raise HTTPException(status_code=422, detail="Некорректный user_id")

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=404, detail="Сотрудник не найден или неактивен")
    if user.role not in ASSIGNABLE_ROLES:
        raise HTTPException(
            status_code=422,
            detail="Ответственным может быть только сотрудник: администратор, МЗК-менеджер или ментор",
        )

    existing = await db.scalar(
        select(StudentResponsibility).where(
            StudentResponsibility.student_id == student_id,
            StudentResponsibility.area == parsed,
        )
    )
    note = (body.get("note") or "").strip() or None
    if existing:
        existing.user_id = user_id
        existing.assigned_by = current_user.id
        existing.note = note
    else:
        db.add(StudentResponsibility(
            student_id=student_id,
            area=parsed,
            user_id=user_id,
            assigned_by=current_user.id,
            note=note,
        ))
    await db.commit()

    assigned = await _load(db, student_id)
    return {"area": parsed.value, "assigned": assigned.get(parsed.value), "coverage": _coverage(assigned)}


@router.delete("/students/{student_id}/{area}")
async def clear_responsibility(
    student_id: uuid.UUID,
    area: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Снять ответственного. Зона становится пустой и попадает в «не закрыто»."""
    require_access(current_user, "responsibilities", Action.manage)
    await require_student_access(db, student_id, current_user)
    parsed = _parse_area(area)

    await db.execute(
        delete(StudentResponsibility).where(
            StudentResponsibility.student_id == student_id,
            StudentResponsibility.area == parsed,
        )
    )
    await db.commit()

    assigned = await _load(db, student_id)
    return {"area": parsed.value, "assigned": None, "coverage": _coverage(assigned)}


@router.get("/overview")
async def responsibilities_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    only_incomplete: bool = Query(False, description="Только ученики с незакрытыми зонами"),
    user_id: uuid.UUID | None = Query(None, description="Только участки этого сотрудника"),
    limit: int = Query(100, ge=1, le=500),
):
    """Матрица «ученики × зоны» для конструктора.

    Заполнять зоны по одному ученику невозможно — их сотни; массовый экран и
    есть то «отдельное окно», ради которого раздел затевался.
    """
    require_access(current_user, "responsibilities", Action.view)

    students_stmt = select(Student).where(Student.is_archived == False)  # noqa: E712
    allowed_ids = await mentor_assigned_student_ids(db, current_user)
    if allowed_ids is not None:
        if not allowed_ids:
            return {"students": [], "areas": [area.value for area in AREA_ORDER]}
        students_stmt = students_stmt.where(Student.id.in_(allowed_ids))

    students = (await db.execute(students_stmt.order_by(Student.full_name).limit(limit))).scalars().all()
    student_ids = [s.id for s in students]
    if not student_ids:
        return {"students": [], "areas": [area.value for area in AREA_ORDER]}

    rows = (await db.execute(
        select(StudentResponsibility)
        .options(selectinload(StudentResponsibility.user))
        .where(StudentResponsibility.student_id.in_(student_ids))
    )).scalars().all()

    by_student: dict[uuid.UUID, dict[str, dict]] = {}
    for item in rows:
        by_student.setdefault(item.student_id, {})[item.area.value] = _row(item)

    out = []
    for student in students:
        assigned = by_student.get(student.id, {})
        if only_incomplete and not _coverage(assigned)["missing_areas"]:
            continue
        if user_id and not any(cell["user_id"] == str(user_id) for cell in assigned.values()):
            continue
        out.append({
            "student_id": str(student.id),
            "student_name": student.full_name,
            "areas": assigned,
            "coverage": _coverage(assigned),
        })

    return {"students": out, "areas": [area.value for area in AREA_ORDER]}
