from __future__ import annotations
import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.models.student import Student
from app.services.excel_export import export_students_list, export_student_card

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/students")
async def export_all_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    intake_year: int | None = None,
    pipeline_status: str | None = None,
):
    from app.api.v1.endpoints.students import list_students
    result = await db.execute(select(Student).order_by(Student.full_name))
    students = result.scalars().all()

    student_dicts = []
    from app.models.contract import Contract
    from datetime import date as date_

    for s in students:
        contract_result = await db.execute(
            select(Contract).where(Contract.student_id == s.id).limit(1)
        )
        contract = contract_result.scalar_one_or_none()
        days = None
        ps = None
        if contract:
            if contract.signed_date:
                days = (date_.today() - contract.signed_date).days
            ps = contract.pipeline_status.value if contract.pipeline_status else None

        student_dicts.append({
            "full_name": s.full_name,
            "phone": s.phone,
            "degree_level": s.degree_level.value,
            "city": s.city,
            "intake_year": s.intake_year,
            "pipeline_status": ps,
            "days_in_work": days,
        })

    content = export_students_list(student_dicts, current_user.role)
    filename = f"students_export_{date.today().isoformat()}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/students/{student_id}")
async def export_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    from sqlalchemy.orm import selectinload
    from app.models.student import Student
    from app.models.contract import Contract

    result = await db.execute(
        select(Student)
        .options(
            selectinload(Student.contracts).selectinload(Contract.payments),
            selectinload(Student.applications),
            selectinload(Student.services),
        )
        .where(Student.id == student_id)
    )
    student = result.scalar_one_or_none()
    if not student:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Студент не найден")

    from app.api.v1.endpoints.students import _student_to_dict
    student_dict = _student_to_dict(student)

    content = export_student_card(student_dict, current_user.role)
    safe_name = student.full_name.replace(" ", "_")[:30]
    filename = f"{safe_name}_{date.today().isoformat()}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
