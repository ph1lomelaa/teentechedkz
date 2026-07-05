"""Notion-зеркало: синк, привязка снапшотов к студентам, сверка и ручной перенос полей.

Notion остаётся рабочим инструментом команды — CRM его не заменяет и назад не пишет.
Автоматически в карточки ничего не переносится: только просмотр расхождений и
кнопка «Принять из Notion» по конкретному полю (с записью в аудит).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.models import NotionSnapshot, NotionMatchStatus, Student, Contract, MentorAssignment
from app.models.contract import PipelineStatus
from app.models.mentor_assignment import MentorRole
from app.models.student import DegreeLevel
from app.models.user import UserRole
from app.services import notion_sync

router = APIRouter(prefix="/notion", tags=["notion"])

_MANAGE_ROLES = (UserRole.admin, UserRole.mzk_manager)


def _require_manager(user) -> None:
    if user.role not in _MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Недостаточно прав")


# --- Вспомогательные форматтеры ----------------------------------------------

_DEGREE_RU = {
    "undergraduate": "Бакалавриат",
    "masters": "Магистратура",
    "foundation": "Foundation",
    "found_ug": "Foundation + Бакалавриат",
}

_PIPELINE_RU = {
    "active_work": "Активная работа",
    "on_visa": "На визе",
    "paused": "Пауза",
    "changed_mind": "Передумали",
    "refund": "На возврате",
    "unpaid": "Не оплачено",
    "transferred_pipeline": "Перевели на другой пайплайн",
    "ielts_retake": "Пересдача IELTS",
    "suspended": "Подвешено",
    "no_status": "Без статуса",
}


def _fmt_num(v) -> str | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return str(v)
    if f == int(f):
        return f"{int(f):,}".replace(",", " ")
    return f"{f:,.2f}".replace(",", " ")


def _fmt_date(v) -> str | None:
    if not v:
        return None
    s = str(v)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return s


def _parse_date(v) -> date | None:
    if not v:
        return None
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _snapshot_to_dict(s: NotionSnapshot) -> dict:
    return {
        "id": str(s.id),
        "notion_page_id": s.notion_page_id,
        "notion_url": s.notion_url,
        "full_name": s.full_name,
        "phone_normalized": s.phone_normalized,
        "suggested_student_id": str(s.suggested_student_id) if s.suggested_student_id else None,
        "suggested_student_name": s.suggested_student.full_name if s.suggested_student else None,
        "suggested_confidence": s.suggested_confidence,
        "student_id": str(s.student_id) if s.student_id else None,
        "status": s.status.value,
        "payment_status": (s.normalized_data or {}).get("payment_status_raw"),
        "intake": (s.normalized_data or {}).get("intake_raw"),
        "synced_at": s.synced_at.isoformat() if s.synced_at else None,
        "notion_last_edited_at": s.notion_last_edited_at.isoformat() if s.notion_last_edited_at else None,
    }


# --- Синк ---------------------------------------------------------------------

@router.post("/run")
async def run_sync_now(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_manager(current_user)
    try:
        counters = await notion_sync.run_sync(db)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка синка Notion: {e}")
    return {"ok": True, "counters": counters}


@router.get("/status")
async def sync_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    return {
        "configured": notion_sync.is_configured(),
        "last_run": notion_sync.last_run,
        "needs_review": await notion_sync.unmatched_count(db),
    }


# --- Агрегированные финансы из Notion (для страницы «Финансы») -------------------

_FINANCE_TOTAL_FIELDS = [
    "client_fee", "client_remaining",
    "mentor_total", "mentor_paid", "mentor_tbp",
    "english_sum", "english_paid", "english_tbp",
    "up_sum", "up_paid", "up_tbp",
    "proforientation_sum", "ielts_exam_fee",
    "total_company",
]


def _as_float(v) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(" ", "").replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


@router.get("/finance-summary")
async def finance_summary(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Суммы всех денежных колонок Notion по живому пайплайну (кроме скрытых записей)."""
    _require_manager(current_user)

    result = await db.execute(
        select(NotionSnapshot).where(NotionSnapshot.status != NotionMatchStatus.ignored)
    )
    snapshots = result.scalars().all()

    totals: dict[str, float] = {f: 0.0 for f in _FINANCE_TOTAL_FIELDS}
    by_status: dict[str, int] = {}
    rows: list[dict] = []
    synced_at = None
    for s in snapshots:
        d = s.normalized_data or {}
        for f in _FINANCE_TOTAL_FIELDS:
            totals[f] += _as_float(d.get(f))
        status = d.get("payment_status_raw") or "Без статуса"
        by_status[status] = by_status.get(status, 0) + 1
        rows.append(
            {
                "id": str(s.id),
                "full_name": s.full_name,
                "payment_status": status,
                "intake": d.get("intake_raw"),
                "client_fee": _as_float(d.get("client_fee")),
                "client_remaining": _as_float(d.get("client_remaining")),
                "mentor_total": _as_float(d.get("mentor_total")),
                "mentor_paid": _as_float(d.get("mentor_paid")),
                "mentor_tbp": _as_float(d.get("mentor_tbp")),
                "english_sum": _as_float(d.get("english_sum")),
                "english_paid": _as_float(d.get("english_paid")),
                "english_tbp": _as_float(d.get("english_tbp")),
                "up_sum": _as_float(d.get("up_sum")),
                "up_paid": _as_float(d.get("up_paid")),
                "up_tbp": _as_float(d.get("up_tbp")),
                "proforientation_sum": _as_float(d.get("proforientation_sum")),
                "ielts_exam_fee": _as_float(d.get("ielts_exam_fee")),
                "total_company": _as_float(d.get("total_company")),
            }
        )
        if s.synced_at and (synced_at is None or s.synced_at > synced_at):
            synced_at = s.synced_at

    return {
        "records": len(snapshots),
        "synced_at": synced_at.isoformat() if synced_at else None,
        "totals": totals,
        "rows": rows,
        "by_status": sorted(
            ({"status": k, "count": v} for k, v in by_status.items()),
            key=lambda x: -x["count"],
        ),
    }


# --- Привязка снапшотов ---------------------------------------------------------

@router.get("/snapshots")
async def list_snapshots(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    status: str = Query(default="new"),
):
    _require_manager(current_user)
    query = select(NotionSnapshot).options(joinedload(NotionSnapshot.suggested_student))
    if status != "all":
        try:
            parsed_status = NotionMatchStatus(status)
        except ValueError:
            raise HTTPException(status_code=422, detail="Неверный статус")
        query = query.where(NotionSnapshot.status == parsed_status)
    result = await db.execute(query.order_by(NotionSnapshot.full_name))
    items = result.scalars().unique().all()
    return {"items": [_snapshot_to_dict(s) for s in items], "total": len(items)}


async def _load_snapshot(db: AsyncSession, snapshot_id: uuid.UUID) -> NotionSnapshot:
    result = await db.execute(
        select(NotionSnapshot)
        .options(joinedload(NotionSnapshot.suggested_student))
        .where(NotionSnapshot.id == snapshot_id)
    )
    snapshot = result.scalars().first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Запись Notion не найдена")
    return snapshot


class LinkBody(BaseModel):
    student_id: uuid.UUID


@router.post("/snapshots/{snapshot_id}/link")
async def link_snapshot(
    snapshot_id: uuid.UUID,
    body: LinkBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_manager(current_user)
    snapshot = await _load_snapshot(db, snapshot_id)
    student = (await db.execute(select(Student).where(Student.id == body.student_id))).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    snapshot.student_id = student.id
    snapshot.status = NotionMatchStatus.linked
    snapshot.manual_unlink = False
    snapshot.linked_by = current_user.id
    snapshot.linked_at = datetime.now(timezone.utc)
    await log_change(
        db, "student", student.id, "notion_snapshot_linked",
        None, snapshot.notion_page_id, str(current_user.id), "notion_sync",
    )
    await db.commit()
    return _snapshot_to_dict(snapshot)


@router.post("/snapshots/{snapshot_id}/unlink")
async def unlink_snapshot(
    snapshot_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Отвязать запись Notion от студента (например, автопривязка оказалась ошибочной)."""
    _require_manager(current_user)
    snapshot = await _load_snapshot(db, snapshot_id)
    if not snapshot.student_id:
        raise HTTPException(status_code=400, detail="Запись и так не привязана")

    old_student_id = snapshot.student_id
    snapshot.student_id = None
    snapshot.suggested_student_id = None
    snapshot.suggested_confidence = None
    snapshot.status = NotionMatchStatus.new
    snapshot.manual_unlink = True
    snapshot.linked_by = current_user.id
    snapshot.linked_at = datetime.now(timezone.utc)
    await log_change(
        db, "student", old_student_id, "notion_snapshot_unlinked",
        snapshot.notion_page_id, None, str(current_user.id), "notion_sync",
    )
    await db.commit()
    return _snapshot_to_dict(snapshot)


@router.post("/snapshots/{snapshot_id}/ignore")
async def ignore_snapshot(
    snapshot_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_manager(current_user)
    snapshot = await _load_snapshot(db, snapshot_id)
    snapshot.student_id = None
    snapshot.status = NotionMatchStatus.ignored
    snapshot.linked_by = current_user.id
    snapshot.linked_at = datetime.now(timezone.utc)
    await db.commit()
    return _snapshot_to_dict(snapshot)


@router.post("/snapshots/link-all")
async def link_all_snapshots(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Привязать все непривязанные снапшоты с предложенным студентом."""
    _require_manager(current_user)
    result = await db.execute(
        select(NotionSnapshot).where(
            NotionSnapshot.status == NotionMatchStatus.new,
            NotionSnapshot.suggested_student_id.isnot(None),
        )
    )
    snapshots = result.scalars().all()
    now = datetime.now(timezone.utc)
    for snapshot in snapshots:
        snapshot.student_id = snapshot.suggested_student_id
        snapshot.status = NotionMatchStatus.linked
        snapshot.linked_by = current_user.id
        snapshot.linked_at = now
        await log_change(
            db, "student", snapshot.student_id, "notion_snapshot_linked",
            None, snapshot.notion_page_id, str(current_user.id), "notion_sync",
        )
    await db.commit()
    return {"ok": True, "linked": len(snapshots)}


# --- Создание студента из Notion-записи ------------------------------------------

async def _create_student_from_snapshot(
    db: AsyncSession, snapshot: NotionSnapshot, user_id: uuid.UUID
) -> Student:
    from migration.transformers.normalize import (
        parse_degree, parse_pipeline_status, COUNTRY_ALIASES,
    )
    from app.models import Application

    d = snapshot.normalized_data or {}

    intake_year = next(
        (int(t) for t in str(d.get("intake_raw") or "").replace(".", " ").split()
         if t.isdigit() and 2020 <= int(t) <= 2035),
        None,
    )

    student = Student(
        full_name=(d.get("full_name") or "Без имени")[:500],
        phone=(d.get("phone") or "")[:100],
        degree_level=DegreeLevel(parse_degree(d.get("degree_raw") or "")),
        intake_year=intake_year or datetime.now(timezone.utc).year + 1,
    )
    db.add(student)
    await db.flush()

    def dec(v) -> Decimal | None:
        return Decimal(str(v)) if v is not None else None

    contract = Contract(
        student_id=student.id,
        pipeline_status=PipelineStatus(parse_pipeline_status(d.get("payment_status_raw") or "")),
        signed_date=_parse_date(d.get("date_of_agreement")),
        amount=dec(d.get("client_fee")),
        english_sum=dec(d.get("english_sum")),
        english_paid=dec(d.get("english_paid")),
        client_remaining_amount=dec(d.get("client_remaining")),
        client_remaining_date=_parse_date(d.get("client_remaining_date")),
        mentor_total_owed=dec(d.get("mentor_total")),
    )
    db.add(contract)
    await db.flush()

    def to_ru_country(name: str) -> str:
        return COUNTRY_ALIASES.get(" ".join(str(name).lower().split()), name)

    for i, country in enumerate(d.get("main_countries") or []):
        db.add(Application(
            student_id=student.id, contract_id=contract.id,
            country=to_ru_country(country), is_primary=(i == 0),
        ))
    for country in d.get("other_countries") or []:
        db.add(Application(student_id=student.id, contract_id=contract.id, country=to_ru_country(country)))

    snapshot.student_id = student.id
    snapshot.status = NotionMatchStatus.linked
    snapshot.linked_by = user_id
    snapshot.linked_at = datetime.now(timezone.utc)

    await log_change(
        db, "student", student.id, "created_from_notion",
        None, snapshot.notion_page_id, str(user_id), "notion_sync",
    )
    return student


@router.post("/snapshots/{snapshot_id}/create-student")
async def create_student_from_snapshot(
    snapshot_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Создать студента (с договором и странами) из Notion-записи и привязать её."""
    _require_manager(current_user)
    snapshot = await _load_snapshot(db, snapshot_id)
    if snapshot.status != NotionMatchStatus.new:
        raise HTTPException(status_code=400, detail="Запись уже обработана")

    # Защита от дублей: имя в CRM могло быть на другом языке — свежий транслит-матч
    from migration.transformers.match import fuzzy_match
    from app.services.notion_sync import _load_students_index

    d = snapshot.normalized_data or {}
    students_index = await _load_students_index(db)
    match = fuzzy_match(d.get("full_name") or "", d.get("phone") or "", students_index)
    if match.student_id and match.confidence >= 0.9:
        existing = next((s for s in students_index if s["id"] == match.student_id), None)
        raise HTTPException(
            status_code=409,
            detail=f"Похоже, этот клиент уже есть в CRM: «{existing['full_name'] if existing else ''}». "
                   f"Используй «Привязать» вместо создания, чтобы не было дубля.",
        )

    student = await _create_student_from_snapshot(db, snapshot, current_user.id)
    await db.commit()
    return {"student_id": str(student.id), "snapshot": _snapshot_to_dict(snapshot)}


@router.post("/snapshots/create-missing")
async def create_missing_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Создать студентов для всех непривязанных записей Notion БЕЗ кандидата.
    Записи с предложенным студентом не трогаем — там решает человек.
    Перед созданием каждая запись перепроверяется транслит-матчем: если похожий
    студент нашёлся, запись пропускается и получает кандидата вместо дубля."""
    _require_manager(current_user)

    from migration.transformers.match import fuzzy_match
    from app.services.notion_sync import _load_students_index

    result = await db.execute(
        select(NotionSnapshot).where(
            NotionSnapshot.status == NotionMatchStatus.new,
            NotionSnapshot.suggested_student_id.is_(None),
        )
    )
    snapshots = result.scalars().all()
    students_index = await _load_students_index(db)

    created = skipped = 0
    for snapshot in snapshots:
        d = snapshot.normalized_data or {}
        match = fuzzy_match(d.get("full_name") or "", d.get("phone") or "", students_index)
        if match.student_id and match.confidence >= 0.9:
            snapshot.suggested_student_id = match.student_id
            snapshot.suggested_confidence = round(match.confidence, 3)
            skipped += 1
            continue
        student = await _create_student_from_snapshot(db, snapshot, current_user.id)
        # чтобы вторая Notion-запись того же человека в этом же прогоне не создала дубль
        students_index.append({
            "id": student.id, "full_name": student.full_name,
            "phone": student.phone, "intake_year": student.intake_year,
        })
        created += 1
    await db.commit()
    return {"ok": True, "created": created, "skipped": skipped}


# --- Сверка по студенту ---------------------------------------------------------

async def _latest_contract(db: AsyncSession, student_id: uuid.UUID) -> Contract | None:
    result = await db.execute(
        select(Contract)
        .options(joinedload(Contract.mzk_manager))
        .where(Contract.student_id == student_id)
        .order_by(Contract.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


def _norm_str(v) -> str:
    return " ".join(str(v or "").lower().split())


def _people_match(notion_name, crm_names: list[str]) -> bool | None:
    """Notion хранит короткие имена ('Beibarys'), CRM — полные. Матч по вхождению."""
    if not notion_name or not crm_names:
        return None
    n = _norm_str(notion_name)
    return any(n in _norm_str(c) or _norm_str(c) in n for c in crm_names)


@router.get("/students/{student_id}")
async def student_notion(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Снапшот Notion, привязанный к студенту, + сверка «Notion | CRM» + финансы."""
    _require_manager(current_user)

    from migration.transformers.normalize import (
        normalize_phone, parse_pipeline_status, parse_degree_or_none,
        names_probably_same, countries_set,
    )

    student = (
        await db.execute(
            select(Student)
            .options(
                joinedload(Student.applications),
                joinedload(Student.mentor_assignments).joinedload(MentorAssignment.mentor),
            )
            .where(Student.id == student_id)
        )
    ).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    result = await db.execute(
        select(NotionSnapshot).where(
            NotionSnapshot.student_id == student_id,
            NotionSnapshot.status == NotionMatchStatus.linked,
        ).order_by(NotionSnapshot.synced_at.desc())
    )
    snapshot = result.scalars().first()
    if not snapshot:
        return {"snapshot": None, "comparison": [], "finance": []}

    d = snapshot.normalized_data or {}
    contract = await _latest_contract(db, student_id)

    def row(field: str, label: str, notion_v, crm_v, matches: bool | None, can_apply: bool) -> dict:
        return {
            "field": field, "label": label,
            "notion": notion_v, "crm": crm_v,
            "matches": matches, "can_apply": can_apply and notion_v is not None,
        }

    comparison: list[dict] = []

    # --- Профиль
    n_name, c_name = d.get("full_name"), student.full_name
    comparison.append(row(
        "full_name", "ФИО", n_name, c_name,
        (_norm_str(n_name) == _norm_str(c_name) or names_probably_same(n_name, c_name or ""))
        if n_name else None,
        True,
    ))

    n_phone = d.get("phone")
    comparison.append(row(
        "phone", "Телефон", n_phone, student.phone,
        normalize_phone(n_phone or "") == normalize_phone(student.phone or "") if n_phone else None,
        True,
    ))

    n_degree = d.get("degree_raw")
    crm_degree = student.degree_level.value if student.degree_level else None
    n_degree_parsed = parse_degree_or_none(n_degree or "")
    comparison.append(row(
        "degree_level", "Ступень", n_degree,
        _DEGREE_RU.get(crm_degree or "", crm_degree),
        n_degree_parsed == crm_degree if n_degree_parsed else None,
        n_degree_parsed is not None,
    ))

    n_intake = d.get("intake_raw")
    intake_year = next(
        (int(t) for t in str(n_intake or "").replace(".", " ").split() if t.isdigit() and 2020 <= int(t) <= 2035),
        None,
    )
    comparison.append(row(
        "intake_year", "Год поступления", n_intake, str(student.intake_year),
        intake_year == student.intake_year if intake_year else None,
        intake_year is not None,
    ))

    # --- Договор
    n_status = d.get("payment_status_raw")
    crm_status = contract.pipeline_status.value if contract else None
    comparison.append(row(
        "pipeline_status", "Статус выплат", n_status,
        _PIPELINE_RU.get(crm_status or "", crm_status),
        parse_pipeline_status(n_status or "") == crm_status if (n_status and crm_status) else None,
        True,
    ))

    n_signed = d.get("date_of_agreement")
    crm_signed = contract.signed_date if contract else None
    comparison.append(row(
        "signed_date", "Дата договора", _fmt_date(n_signed), _fmt_date(crm_signed),
        _parse_date(n_signed) == crm_signed if (n_signed and crm_signed) else None,
        True,
    ))

    def money_row(field: str, label: str, notion_v, crm_v) -> dict:
        matches = None
        if notion_v is not None and crm_v is not None:
            matches = Decimal(str(notion_v)) == Decimal(str(crm_v))
        return row(field, label, _fmt_num(notion_v), _fmt_num(crm_v), matches, True)

    comparison.append(money_row("client_fee", "Client fee", d.get("client_fee"), contract.amount if contract else None))
    comparison.append(money_row("english_sum", "Сумма (англ)", d.get("english_sum"), contract.english_sum if contract else None))
    comparison.append(money_row("english_paid", "Оплачено (англ)", d.get("english_paid"), contract.english_paid if contract else None))
    comparison.append(money_row("mentor_total", "TOTAL (Mentors)", d.get("mentor_total"), contract.mentor_total_owed if contract else None))
    comparison.append(money_row(
        "client_remaining", "Остаток клиента", d.get("client_remaining"),
        contract.client_remaining_amount if contract else None,
    ))

    n_rem_date = d.get("client_remaining_date")
    crm_rem_date = contract.client_remaining_date if contract else None
    comparison.append(row(
        "client_remaining_date", "Остаток (дата)", _fmt_date(n_rem_date), _fmt_date(crm_rem_date),
        _parse_date(n_rem_date) == crm_rem_date if (n_rem_date and crm_rem_date) else None,
        True,
    ))

    # --- Люди и страны: только просмотр (назначения делаются в CRM осознанно)
    assignments = [a for a in (student.mentor_assignments or []) if a.is_active]
    lead_names = [a.mentor.name for a in assignments if a.role == MentorRole.lead and a.mentor]
    all_mentor_names = [a.mentor.name for a in assignments if a.mentor]

    comparison.append(row(
        "lead_mentor", "Lead-ментор", d.get("lead_mentor"), ", ".join(lead_names) or None,
        _people_match(d.get("lead_mentor"), lead_names), False,
    ))
    n_mentors = d.get("mentors") or []
    comparison.append(row(
        "mentors", "Менторы", ", ".join(n_mentors) or None, ", ".join(all_mentor_names) or None,
        all(_people_match(m, all_mentor_names) for m in n_mentors) if (n_mentors and all_mentor_names) else None,
        False,
    ))
    mzk_name = contract.mzk_manager.name if (contract and contract.mzk_manager) else None
    comparison.append(row(
        "mzk", "МЗК", d.get("mzk"), mzk_name,
        _people_match(d.get("mzk"), [mzk_name] if mzk_name else []), False,
    ))

    n_countries = (d.get("main_countries") or []) + (d.get("other_countries") or [])
    crm_countries = [a.country for a in (student.applications or [])]
    n_set = countries_set(", ".join(n_countries))
    crm_set = countries_set(", ".join(crm_countries))
    comparison.append(row(
        "countries", "Страны", ", ".join(n_countries) or None, ", ".join(crm_countries) or None,
        (n_set <= crm_set or crm_set <= n_set) if (n_set and crm_set) else None,
        False,
    ))

    comparison = [r for r in comparison if r["notion"] is not None or r["crm"] is not None]

    # --- Финансы Notion, которых нет в CRM-моделях: просто показываем
    finance = [
        {"label": label, "value": value}
        for label, value in [
            ("TOTAL (Company)", _fmt_num(d.get("total_company"))),
            ("PAID (Mentors)", _fmt_num(d.get("mentor_paid"))),
            ("TBP (Mentors)", _fmt_num(d.get("mentor_tbp"))),
            ("TBP (англ)", _fmt_num(d.get("english_tbp"))),
            ("Сумм УП", _fmt_num(d.get("up_sum"))),
            ("PAID УП", _fmt_num(d.get("up_paid"))),
            ("TBP УП", _fmt_num(d.get("up_tbp"))),
            ("УП активности", ", ".join(d.get("up_activities") or []) or None),
            ("Сумм Профориентация", _fmt_num(d.get("proforientation_sum"))),
            ("IELTS exam fee", _fmt_num(d.get("ielts_exam_fee"))),
            ("Себестоимость, %", _fmt_num(d.get("cost_percent"))),
            ("Дней в работе", _fmt_num(d.get("days_in_work"))),
        ]
        if value is not None
    ]

    return {
        "snapshot": _snapshot_to_dict(snapshot),
        "comparison": comparison,
        "finance": finance,
    }


# --- Ручной перенос поля Notion → CRM -------------------------------------------

class ApplyFieldBody(BaseModel):
    field: str


@router.post("/students/{student_id}/apply-field")
async def apply_field(
    student_id: uuid.UUID,
    body: ApplyFieldBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Принять значение из Notion в CRM. Только whitelisted-поля, каждое — в аудит."""
    _require_manager(current_user)

    from migration.transformers.normalize import parse_pipeline_status, parse_degree_or_none

    student = (await db.execute(select(Student).where(Student.id == student_id))).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    result = await db.execute(
        select(NotionSnapshot).where(
            NotionSnapshot.student_id == student_id,
            NotionSnapshot.status == NotionMatchStatus.linked,
        ).order_by(NotionSnapshot.synced_at.desc())
    )
    snapshot = result.scalars().first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Notion-запись не привязана к студенту")

    d = snapshot.normalized_data or {}
    field = body.field

    async def audit(entity: str, entity_id: uuid.UUID, old, new) -> None:
        await log_change(
            db, entity, entity_id, f"notion_apply:{field}",
            str(old) if old is not None else None,
            str(new) if new is not None else None,
            str(current_user.id), "notion_sync",
        )

    contract_fields = {
        "pipeline_status", "signed_date", "client_fee", "english_sum",
        "english_paid", "mentor_total", "client_remaining", "client_remaining_date",
    }
    contract: Contract | None = None
    if field in contract_fields:
        contract = await _latest_contract(db, student_id)
        if not contract:
            contract = Contract(student_id=student_id)
            db.add(contract)
            await db.flush()

    def dec(v) -> Decimal | None:
        return Decimal(str(v)) if v is not None else None

    if field == "full_name":
        if not d.get("full_name"):
            raise HTTPException(status_code=400, detail="В Notion нет значения")
        await audit("student", student.id, student.full_name, d["full_name"])
        student.full_name = str(d["full_name"])[:500]
    elif field == "phone":
        if not d.get("phone"):
            raise HTTPException(status_code=400, detail="В Notion нет значения")
        await audit("student", student.id, student.phone, d["phone"])
        student.phone = str(d["phone"])[:100]
    elif field == "degree_level":
        parsed = parse_degree_or_none(d.get("degree_raw") or "")
        if not parsed:
            raise HTTPException(status_code=400, detail=f"Не распознана ступень: {d.get('degree_raw')}")
        await audit("student", student.id, student.degree_level.value if student.degree_level else None, parsed)
        student.degree_level = DegreeLevel(parsed)
    elif field == "intake_year":
        year = next(
            (int(t) for t in str(d.get("intake_raw") or "").replace(".", " ").split()
             if t.isdigit() and 2020 <= int(t) <= 2035),
            None,
        )
        if not year:
            raise HTTPException(status_code=400, detail=f"Не распознан год: {d.get('intake_raw')}")
        await audit("student", student.id, student.intake_year, year)
        student.intake_year = year
    elif field == "pipeline_status":
        new_status = parse_pipeline_status(d.get("payment_status_raw") or "")
        await audit("contract", contract.id, contract.pipeline_status.value, new_status)
        contract.pipeline_status = PipelineStatus(new_status)
    elif field == "signed_date":
        new_date = _parse_date(d.get("date_of_agreement"))
        if not new_date:
            raise HTTPException(status_code=400, detail="В Notion нет даты договора")
        await audit("contract", contract.id, contract.signed_date, new_date)
        contract.signed_date = new_date
    elif field == "client_fee":
        await audit("contract", contract.id, contract.amount, d.get("client_fee"))
        contract.amount = dec(d.get("client_fee"))
    elif field == "english_sum":
        await audit("contract", contract.id, contract.english_sum, d.get("english_sum"))
        contract.english_sum = dec(d.get("english_sum"))
    elif field == "english_paid":
        await audit("contract", contract.id, contract.english_paid, d.get("english_paid"))
        contract.english_paid = dec(d.get("english_paid"))
    elif field == "mentor_total":
        await audit("contract", contract.id, contract.mentor_total_owed, d.get("mentor_total"))
        contract.mentor_total_owed = dec(d.get("mentor_total"))
    elif field == "client_remaining":
        await audit("contract", contract.id, contract.client_remaining_amount, d.get("client_remaining"))
        contract.client_remaining_amount = dec(d.get("client_remaining"))
    elif field == "client_remaining_date":
        new_date = _parse_date(d.get("client_remaining_date"))
        await audit("contract", contract.id, contract.client_remaining_date, new_date)
        contract.client_remaining_date = new_date
    else:
        raise HTTPException(status_code=400, detail=f"Поле не переносится из Notion: {field}")

    await db.commit()
    return {"ok": True, "field": field}
