from __future__ import annotations
import uuid
from datetime import date, datetime
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.permissions import Action, require_access
from app.models.student import Student
from app.models.user import User
from app.models.contract import Contract
from app.models.application import Application
from app.models.notion_snapshot import NotionSnapshot
from app.models.mentor_assignment import MentorAssignment
from app.models.telegram_chat import TelegramChat
from app.models.telegram_chat_session import TelegramChatSession
from app.services.student_export import COLUMNS, DEFAULT_COLUMNS, make_rows, serialize_rows
from app.services.excel_export import export_student_card

router = APIRouter(prefix="/export", tags=["export"])


async def _export_rows(
    db: AsyncSession, dataset: str, student_ids: list[uuid.UUID] | None,
    snapshot_ids: list[uuid.UUID] | None,
    limit_to_ids: bool,
    require_portal_access: bool, require_chat: bool, require_mzk: bool, require_mentor: bool,
    portal_access: str, active_chat: str, has_mzk: str, has_mentor: str, notion_link: str,
    intake_years: list[str], notion_statuses: list[str], crm_statuses: list[str], degrees: list[str], countries: list[str],
    lead_mentors: list[str], responsible_role: str | None, responsible_name: str | None,
    only_active_notion: bool, only_status_mismatch: bool,
    search: str,
):
    if dataset not in {"all", "notion_active", "platform_access", "status_mismatch"}:
        raise HTTPException(422, "Неизвестный набор данных")
    for label, value in (("доступ", portal_access), ("чат", active_chat), ("МЗК", has_mzk), ("ментор", has_mentor), ("связь с Notion", notion_link)):
        if value not in {"any", "yes", "no"}:
            raise HTTPException(422, f"Неверное условие: {label}")
    query = select(Student).where(Student.is_archived.is_(False)).order_by(Student.full_name)
    if limit_to_ids:
        query = query.where(Student.id.in_(set(student_ids or []))) if student_ids else query.where(False)
    students = (await db.execute(query)).scalars().all()
    contracts = (await db.execute(select(Contract))).scalars().all()
    snapshots = (await db.execute(select(NotionSnapshot))).scalars().all()
    users = (await db.execute(select(User))).scalars().all()
    assignments = (await db.execute(select(MentorAssignment))).scalars().all()
    applications = (await db.execute(select(Application))).scalars().all()
    sessions = (await db.execute(select(TelegramChatSession, TelegramChat).join(TelegramChat, TelegramChatSession.chat_id == TelegramChat.id))).all()
    return make_rows(
        students, contracts, snapshots, users, assignments, sessions, dataset, applications=applications,
        require_portal_access=require_portal_access, require_chat=require_chat,
        require_mzk=require_mzk, require_mentor=require_mentor,
        student_ids=set(student_ids or []) if limit_to_ids else None,
        portal_access=portal_access, active_chat=active_chat, has_mzk=has_mzk,
        has_mentor=has_mentor, notion_link=notion_link,
        notion_snapshot_ids=set(snapshot_ids or []) if limit_to_ids and snapshot_ids is not None else None,
        only_active_notion=only_active_notion, only_status_mismatch=only_status_mismatch,
        search=search,
        field_filters={
            **({"intake_year": set(intake_years)} if intake_years else {}),
            **({"notion_status": set(notion_statuses)} if notion_statuses else {}),
            **({"crm_status": set(crm_statuses)} if crm_statuses else {}),
            **({"degree_level": set(degrees)} if degrees else {}),
            **({"countries": set(countries)} if countries else {}),
            **({"lead_mentor": set(lead_mentors)} if lead_mentors else {}),
            **({responsible_role: {responsible_name}} if responsible_role in {"mzk", "mentors", "lead_mentor"} and responsible_name else {}),
        },
    )


def _validate_columns(columns: list[str] | None) -> list[str]:
    selected = columns or list(DEFAULT_COLUMNS)
    if not selected or len(selected) > len(COLUMNS) or len(set(selected)) != len(selected) or any(key not in COLUMNS for key in selected):
        raise HTTPException(422, "Неверный список столбцов")
    return selected


@router.get("/students")
async def export_all_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    dataset: str = "all",
    format: str = "xlsx",
    columns: list[str] | None = Query(default=None),
    require_portal_access: bool = False,
    require_chat: bool = False,
    require_mzk: bool = False,
    require_mentor: bool = False,
    student_ids: list[uuid.UUID] | None = Query(default=None),
    snapshot_ids: list[uuid.UUID] | None = Query(default=None),
    limit_to_ids: bool = False,
    portal_access: str = "any",
    active_chat: str = "any",
    has_mzk: str = "any",
    has_mentor: str = "any",
    notion_link: str = "any",
    delimiter: str = ";",
    bom: bool = True,
    filename: str | None = None,
    total_row: bool = False,
    split_by: str = "none",
    only_active_notion: bool = False,
    only_status_mismatch: bool = False,
    search: str = "",
    intake_years: list[str] = Query(default=[]),
    notion_statuses: list[str] = Query(default=[]),
    crm_statuses: list[str] = Query(default=[]),
    degrees: list[str] = Query(default=[]),
    countries: list[str] = Query(default=[]),
    lead_mentors: list[str] = Query(default=[]),
    responsible_role: str | None = None,
    responsible_name: str | None = None,
):
    require_access(current_user, "export", Action.manage)
    if format not in {"xlsx", "csv", "tsv"}:
        raise HTTPException(422, "Неизвестный формат")
    if delimiter not in {";", ",", "\t"}:
        raise HTTPException(422, "Неверный разделитель CSV")
    selected_columns = _validate_columns(columns)
    rows = await _export_rows(db, dataset, student_ids, snapshot_ids, limit_to_ids, require_portal_access, require_chat, require_mzk, require_mentor,
                              portal_access, active_chat, has_mzk, has_mentor, notion_link,
                              intake_years, notion_statuses, crm_statuses, degrees, countries, lead_mentors, responsible_role, responsible_name,
                              only_active_notion, only_status_mismatch, search)
    if split_by not in {"none", "intake_year", "notion_status", "mzk"}:
        raise HTTPException(422, "Неверное разбиение на листы")
    filters = [
        *( [f"Поиск: {search}"] if search.strip() else [] ),
        *( [f"Набор: {', '.join(intake_years)}"] if intake_years else [] ),
        *( [f"Статус Notion: {', '.join(notion_statuses)}"] if notion_statuses else [] ),
        *( [f"Статус CRM: {', '.join(crm_statuses)}"] if crm_statuses else [] ),
        *( [f"Уровень: {', '.join(degrees)}"] if degrees else [] ),
        *( [f"Страна: {', '.join(countries)}"] if countries else [] ),
        *( [f"Lead-Mentor: {', '.join(lead_mentors)}"] if lead_mentors else [] ),
        *( [f"Доступ к платформе: {portal_access}"] if portal_access != "any" else [] ),
        *( [f"Активный чат: {active_chat}"] if active_chat != "any" else [] ),
        *( [f"МЗК: {has_mzk}"] if has_mzk != "any" else [] ),
        *( [f"Ментор: {has_mentor}"] if has_mentor != "any" else [] ),
        *( [f"Связь с Notion: {notion_link}"] if notion_link != "any" else [] ),
        *( ["Статус Notion: Активная работа"] if only_active_notion or dataset == "notion_active" else [] ),
        *( ["Расходятся статусы Notion и CRM"] if only_status_mismatch or dataset == "status_mismatch" else [] ),
        *( [f"Ответственный: {responsible_role} · {responsible_name}"] if responsible_role and responsible_name else [] ),
    ]
    content = serialize_rows(rows, selected_columns, format, delimiter=delimiter, bom=bom, total_row=total_row, split_by=split_by,
                            parameters={"Кто выгрузил": current_user.name, "Когда": datetime.now().astimezone().isoformat(timespec="seconds"),
                                        "Набор данных": dataset, "Условия": "; ".join(filters) if filters else "Вся база без фильтров",
                                        "Столбцы": ", ".join(COLUMNS[column] for column in selected_columns), "Разбиение на листы": split_by,
                                        "Ограниченный список": "Да" if limit_to_ids else "Нет", "Строк": str(len(rows)), "Источник": "CRM + локальный снимок Notion"})
    import re
    safe_name = re.sub(r'[\\/:*?"<>|\r\n]', "_", (filename or f"Студенты_{dataset}_{date.today().isoformat()}")).strip(" .")[:120] or "Студенты"
    filename = f"{safe_name}.{format}"
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or f"students.{format}"
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8" if format in {"csv", "tsv"} else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(filename)}', "X-Export-Count": str(len(rows))},
    )


@router.get("/students/preview")
async def preview_student_export(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    dataset: str = "all",
    columns: list[str] | None = Query(default=None),
    student_ids: list[uuid.UUID] | None = Query(default=None),
    snapshot_ids: list[uuid.UUID] | None = Query(default=None),
    limit_to_ids: bool = False,
    require_portal_access: bool = False,
    require_chat: bool = False,
    require_mzk: bool = False,
    require_mentor: bool = False,
    portal_access: str = "any",
    active_chat: str = "any",
    has_mzk: str = "any",
    has_mentor: str = "any",
    notion_link: str = "any",
    intake_years: list[str] = Query(default=[]),
    notion_statuses: list[str] = Query(default=[]),
    crm_statuses: list[str] = Query(default=[]),
    degrees: list[str] = Query(default=[]),
    countries: list[str] = Query(default=[]),
    lead_mentors: list[str] = Query(default=[]),
    responsible_role: str | None = None,
    responsible_name: str | None = None,
    split_by: str = "none",
    only_active_notion: bool = False,
    only_status_mismatch: bool = False,
    search: str = "",
):
    require_access(current_user, "export", Action.manage)
    selected_columns = _validate_columns(columns)
    rows = await _export_rows(db, dataset, student_ids, snapshot_ids, limit_to_ids, require_portal_access, require_chat, require_mzk, require_mentor,
                              portal_access, active_chat, has_mzk, has_mentor, notion_link,
                              intake_years, notion_statuses, crm_statuses, degrees, countries, lead_mentors, responsible_role, responsible_name,
                              only_active_notion, only_status_mismatch, search)
    if split_by not in {"none", "intake_year", "notion_status", "mzk"}:
        raise HTTPException(422, "Неверное разбиение на листы")
    labels = {"intake_year": "год набора", "notion_status": "статус", "mzk": "МЗК"}
    grouped: dict[str, list[dict[str, str]]] = {}
    if split_by != "none":
        for row in rows:
            name = row.get(split_by, "").strip() or f"Без {labels[split_by]}"
            grouped.setdefault(name, []).append(row)
    groups = sorted(grouped.items(), key=lambda item: (item[0].startswith("Без "), item[0].casefold()))
    return {"count": len(rows), "columns": [COLUMNS[key] for key in selected_columns],
            "rows": [{COLUMNS[key]: row[key] for key in selected_columns} for row in rows[:6]],
            "groups": [{"name": name, "count": len(group_rows), "rows": [{COLUMNS[key]: row[key] for key in selected_columns} for row in group_rows[:6]]} for name, group_rows in groups]}


@router.get("/students/{student_id}")
async def export_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    require_access(current_user, "export", Action.manage)
    from sqlalchemy.orm import selectinload
    from app.models.student import Student
    from app.models.contract import Contract

    # Набор связей берём у самого сериализатора (student_card_loaders): здесь
    # он был неполным — не хватало portfolio_progress, documents, student_tasks,
    # mentor_assignments, communication_logs, pending_insights и notes, поэтому
    # выгрузка карточки студента падала с MissingGreenlet на первой же из них.
    from app.api.v1.endpoints.students import student_card_loaders

    result = await db.execute(
        select(Student)
        .options(
            *student_card_loaders(),
            selectinload(Student.contracts).selectinload(Contract.payments),
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
    # Cyrillic names aren't latin-1-encodable — HTTP headers are, so this
    # crashed with UnicodeEncodeError for any non-ASCII student name (same
    # bug class as the document download endpoint).
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "student.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{ascii_fallback}"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )
