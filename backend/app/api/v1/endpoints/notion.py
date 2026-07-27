"""Notion-зеркало: синк, привязка снапшотов к студентам, сверка и ручной перенос полей.

Notion остаётся рабочим инструментом команды. Автоматически ничего не переносится
ни в одну сторону: только просмотр расхождений и ручные кнопки по конкретному полю
(с записью в аудит):
- «Принять из Notion» — значение Notion → CRM (apply_field);
- «→ Notion» — значение CRM → Notion (push_field), по подтверждению менеджера.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.models import NotionSnapshot, NotionMatchStatus, Student, Contract, MentorAssignment
from app.models.contract import PipelineStatus
from app.models.mentor_assignment import MentorRole
from app.models.payment import Payment, PaymentType, PaymentStatus
from app.models.portfolio_progress import PortfolioProgress
from app.models.student import DegreeLevel
from app.models.user import UserRole
from app.services import notion_sync, notion_write, contract_finance
from app.services.default_services import ensure_default_services

router = APIRouter(prefix="/notion", tags=["notion"])

_MANAGE_ROLES = (UserRole.admin, UserRole.mzk_manager, UserRole.mentor)


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

# --- Запись CRM → Notion (push_field) ---
# Какие поля сверки можно писать обратно в Notion и в какую колонку.
# Только базовые редактируемые колонки — формульные/rollup (TBP, TOTAL Company,
# Себес, d в работе) сюда НЕ входят, писать в них Notion не даёт. Реальный тип
# колонки проверяется по схеме БД в момент записи (notion_write.WRITABLE_TYPES).
# None у full_name — title-колонка называется произвольно, ищется по типу.
PUSH_FIELDS: dict[str, str | None] = {
    "full_name": None,
    "phone": "Номер тел",
    "degree_level": "Degree",
    "intake_year": "Intake",
    "pipeline_status": "Статус выплат",
    "signed_date": "Date of Agreement",
    "client_fee": "Client fee",
    "english_sum": "Сумм Англ",
    "english_paid": "PAID Англ",
    "client_remaining": "Остаток клиента",
    "client_remaining_date": "Остаток клиента (дата)",
    "mentor_total": "TOTAL (Mentors)",
}

# Поля-select: запись только по существующей опции Notion — подбираем ту, что
# парсер приводит к тому же CRM-значению (не плодим дубли-опции). В живой базе
# Degree/Статус выплат/Intake — все select; Intake-опции это просто годы («2025»).
_PUSH_SELECT_PARSERS = {
    "degree_level": "degree",
    "pipeline_status": "pipeline",
    "intake_year": "intake",
}


def _parse_intake_option(option: str) -> int | None:
    """Опция select «Intake» — год строкой («2025»). Сопоставляем с intake_year (int)."""
    s = str(option).strip()
    return int(s) if s.isdigit() else None

# field → ключ в snapshot.normalized_data (имена там свои: degree_raw и т.п.).
# Нужен, чтобы взять «старое» значение Notion для аудита и обновить снапшот после записи.
_SNAPSHOT_KEY = {
    "full_name": "full_name",
    "phone": "phone",
    "degree_level": "degree_raw",
    "intake_year": "intake_raw",
    "pipeline_status": "payment_status_raw",
    "signed_date": "date_of_agreement",
    "client_fee": "client_fee",
    "english_sum": "english_sum",
    "english_paid": "english_paid",
    "client_remaining": "client_remaining",
    "client_remaining_date": "client_remaining_date",
    "mentor_total": "mentor_total",
}

_PUSH_CONTRACT_FIELDS = {
    "pipeline_status", "signed_date", "client_fee", "english_sum",
    "english_paid", "client_remaining", "client_remaining_date", "mentor_total",
}


def _crm_push_value(field: str, student: Student, contract: "Contract | None"):
    """CRM-значение поля в «сыром» виде для записи в Notion (Decimal/date/int/str
    или строковое значение enum для select). None — если в CRM пусто."""
    if field == "full_name":
        return student.full_name
    if field == "phone":
        return student.phone
    if field == "degree_level":
        return student.degree_level.value if student.degree_level else None
    if field == "intake_year":
        return student.intake_year
    if not contract:
        return None
    if field == "pipeline_status":
        return contract.pipeline_status.value if contract.pipeline_status else None
    if field == "signed_date":
        return contract.signed_date
    if field == "client_fee":
        return contract.amount
    if field == "english_sum":
        return contract.english_sum
    if field == "english_paid":
        return contract.english_paid
    if field == "client_remaining":
        return contract.client_remaining_amount
    if field == "client_remaining_date":
        return contract.client_remaining_date
    if field == "mentor_total":
        return contract.mentor_total_owed
    return None


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
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Недостаточно прав для запуска синхронизации")
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
        "last_run": await notion_sync.last_run(),
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


async def _crm_finance_map(db: AsyncSession, student_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """CRM-финансы (источник правды) по студентам: остаток клиента и «осталось
    доплатить» (TBP) из последнего договора и фактических платежей. Значения тех же
    величин из Notion фронт показывает рядом для сверки — здесь их не трогаем.

    Возвращает {student_id: {client_remaining, english_tbp, mentor_tbp, tbp_total,
    amount, client_paid, mentor_paid}}. Decimal|None → сериализуем во float|None."""
    if not student_ids:
        return {}

    # Последний договор по каждому студенту (по created_at).
    contracts = (await db.execute(
        select(Contract)
        .where(Contract.student_id.in_(student_ids))
        .order_by(Contract.student_id, Contract.created_at.desc())
    )).scalars().all()
    latest: dict[uuid.UUID, Contract] = {}
    for c in contracts:
        latest.setdefault(c.student_id, c)  # первый по DESC == самый свежий

    contract_ids = [c.id for c in latest.values()]
    if not contract_ids:
        return {}

    # Оплачено клиентом / выплачено менторам — суммы подтверждённых платежей по договору.
    paid_rows = (await db.execute(
        select(Payment.contract_id, Payment.type, func.sum(Payment.amount))
        .where(
            Payment.contract_id.in_(contract_ids),
            Payment.status == PaymentStatus.paid,
            Payment.type.in_((PaymentType.client_payment, PaymentType.mentor_payout)),
        )
        .group_by(Payment.contract_id, Payment.type)
    )).all()
    client_paid: dict[uuid.UUID, Decimal] = {}
    mentor_paid: dict[uuid.UUID, Decimal] = {}
    for contract_id, ptype, total in paid_rows:
        (client_paid if ptype == PaymentType.client_payment else mentor_paid)[contract_id] = total or Decimal("0")

    def f(v: Decimal | None) -> float | None:
        return float(v) if v is not None else None

    out: dict[uuid.UUID, dict] = {}
    for sid, c in latest.items():
        cp = client_paid.get(c.id)
        mp = mentor_paid.get(c.id)
        cr = contract_finance.client_remaining(c.amount, cp, manual_remaining=c.client_remaining_amount)
        etbp = contract_finance.english_tbp(c.english_sum, c.english_paid)
        mtbp = contract_finance.mentor_tbp(c.mentor_total_owed, mp)
        out[sid] = {
            "client_remaining": f(cr),
            "english_tbp": f(etbp),
            "mentor_tbp": f(mtbp),
            "tbp_total": f(contract_finance.tbp_total(etbp, mtbp)),
            "amount": f(c.amount),
            "client_paid": f(cp),
            "mentor_paid": f(mp),
        }
    return out


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

    linked_student_ids = [s.student_id for s in snapshots if s.student_id]
    portfolio_map: dict[uuid.UUID, PortfolioProgress] = {}
    crm_fin: dict[uuid.UUID, dict] = {}
    if linked_student_ids:
        pf_result = await db.execute(
            select(PortfolioProgress).where(PortfolioProgress.student_id.in_(linked_student_ids))
        )
        portfolio_map = {p.student_id: p for p in pf_result.scalars().all()}
        crm_fin = await _crm_finance_map(db, linked_student_ids)

    totals: dict[str, float] = {f: 0.0 for f in _FINANCE_TOTAL_FIELDS}
    by_status: dict[str, int] = {}
    rows: list[dict] = []
    synced_at = None
    # "Остаток клиента" в Notion иногда просто не заполнен (Empty) — это не то
    # же самое, что подтверждённый 0. totals["client_remaining"] суммирует
    # только заполненные ячейки; client_remaining_known_count/total_count
    # показывают, по какой доле записей эта сумма вообще посчитана, чтобы
    # фронт не выдавал частичную сумму за полную картину.
    client_remaining_known_count = 0
    # CRM-итоги (источник правды): суммируем только по строкам с договором в CRM.
    crm_totals = {"client_remaining": 0.0, "english_tbp": 0.0, "mentor_tbp": 0.0, "tbp_total": 0.0}
    crm_known_count = 0
    for s in snapshots:
        d = s.normalized_data or {}
        for f in _FINANCE_TOTAL_FIELDS:
            if f == "client_remaining":
                continue
            totals[f] += _as_float(d.get(f))
        remaining_raw = d.get("client_remaining")
        if remaining_raw not in (None, ""):
            totals["client_remaining"] += _as_float(remaining_raw)
            client_remaining_known_count += 1
        status = d.get("payment_status_raw") or "Без статуса"
        by_status[status] = by_status.get(status, 0) + 1
        pf = portfolio_map.get(s.student_id) if s.student_id else None
        crm = crm_fin.get(s.student_id) if s.student_id else None
        if crm:
            crm_known_count += 1
            for k in crm_totals:
                v = crm.get(k)
                if v is not None:
                    crm_totals[k] += v
        raw_remaining = d.get("client_remaining")
        mentors_list = d.get("mentors") or []
        rows.append(
            {
                "id": str(s.id),
                "student_id": str(s.student_id) if s.student_id else None,
                "full_name": s.full_name,
                "payment_status": status,
                "intake": d.get("intake_raw"),
                "client_remaining_date": d.get("client_remaining_date") or None,
                "client_fee": _as_float(d.get("client_fee")),
                "client_remaining": _as_float(raw_remaining),
                # В Notion «Остаток клиента» — числовое поле/формула, которую иногда просто не
                # заполняют (Empty) — это НЕ то же самое, что подтверждённый 0 (полностью оплачено).
                # Фронт должен показывать «нет данных», а не «0», когда client_remaining_filled=false.
                "client_remaining_filled": raw_remaining not in (None, ""),
                # CRM-расчёт (источник правды): остаток клиента = Client fee − оплачено, и
                # «осталось доплатить» (TBP) из договора+платежей. None, если нет договора.
                # Notion-значения (client_remaining/*_tbp выше) остаются рядом для сверки.
                "crm_client_remaining": crm.get("client_remaining") if crm else None,
                "crm_english_tbp": crm.get("english_tbp") if crm else None,
                "crm_mentor_tbp": crm.get("mentor_tbp") if crm else None,
                "crm_tbp_total": crm.get("tbp_total") if crm else None,
                "crm_client_paid": crm.get("client_paid") if crm else None,
                "crm_mentor_paid": crm.get("mentor_paid") if crm else None,
                "lead_mentor": d.get("lead_mentor"),
                "mentors": mentors_list,
                "mzk": d.get("mzk"),
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
                "portfolio_status": pf.status.value if pf else None,
                "portfolio_achievements": pf.achievements_count if pf else None,
                "portfolio_calls": pf.calls_count if pf else None,
            }
        )
        if s.synced_at and (synced_at is None or s.synced_at > synced_at):
            synced_at = s.synced_at

    last_run = await notion_sync.last_run()
    return {
        "records": len(snapshots),
        # last_run — время последнего прохода синка (строки без изменений не трогаются)
        "synced_at": last_run.get("at") or (synced_at.isoformat() if synced_at else None),
        "totals": totals,
        # CRM-итоги считаются из договоров+платежей (источник правды); crm_known_count —
        # по скольким записям есть договор в CRM (по остальным CRM-данных нет).
        "crm_totals": crm_totals,
        "crm_known_count": crm_known_count,
        "client_remaining_known_count": client_remaining_known_count,
        "client_remaining_total_count": len(snapshots),
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
    student = (
        await db.execute(
            select(Student).where(Student.id == body.student_id, Student.is_archived == False)  # noqa: E712
        )
    ).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден или архивирован")

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
        select(NotionSnapshot)
        .join(Student, Student.id == NotionSnapshot.suggested_student_id)
        .where(
            NotionSnapshot.status == NotionMatchStatus.new,
            NotionSnapshot.suggested_student_id.isnot(None),
            Student.is_archived == False,  # noqa: E712
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

    await ensure_default_services(db, student.id)

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


def _conflict_norm(field: str, v) -> str:
    """Сравнение «снапшот vs текущее значение Notion» для проверки конфликта при
    push. Для телефона снапшот хранит очищенные цифры (clean_phone при синке), а
    живое значение из Notion — как оно отформатировано там («+7 708 220 7440») —
    обычная строковая нормализация их никогда не уравняет, вызывая ложный конфликт
    на каждой попытке записи. Сравниваем по цифрам вместо текста."""
    if field == "phone":
        from migration.transformers.normalize import normalize_phone
        return normalize_phone(str(v or "")) or ""
    return _norm_str(v)


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
                selectinload(Student.applications),
                selectinload(Student.mentor_assignments).selectinload(MentorAssignment.mentor),
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
            # Записать CRM → Notion можно для whitelisted-полей, если в CRM есть значение.
            "can_push": field in PUSH_FIELDS and crm_v is not None,
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

    # --- Направление синхронизации по каждому редактируемому полю относительно эталона:
    # notion_newer / crm_newer / conflict / unknown / resolved. Показывает менеджеру,
    # какую сторону подтверждать, а не «расхождение» вслепую.
    canon = notion_sync.editable_canon(d, student, contract)
    baseline = snapshot.synced_baseline or {}
    for r in comparison:
        pair = canon.get(r["field"])
        if pair is not None:
            r["direction"] = notion_sync.field_direction(baseline.get(r["field"]), pair[0], pair[1])

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


def _record_baseline(snapshot: NotionSnapshot, field: str, student: Student, contract: "Contract | None") -> None:
    """После подтверждения (apply/push) стороны сравнялись — фиксируем это значение в
    эталоне, чтобы поле сразу стало «согласованным» и не мигало расхождением до синка."""
    canon = notion_sync.editable_canon(snapshot.normalized_data or {}, student, contract)
    pair = canon.get(field)
    if pair is None:
        return
    agreed = pair[0] if pair[0] is not None else pair[1]
    if agreed is None:
        return
    baseline = dict(snapshot.synced_baseline or {})
    baseline[field] = agreed
    snapshot.synced_baseline = baseline


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
        if not new_date:
            raise HTTPException(status_code=400, detail="В Notion нет даты остатка")
        await audit("contract", contract.id, contract.client_remaining_date, new_date)
        contract.client_remaining_date = new_date
    else:
        raise HTTPException(status_code=400, detail=f"Поле не переносится из Notion: {field}")

    _record_baseline(snapshot, field, student, contract)
    await db.commit()
    return {"ok": True, "field": field}


# --- Ручная запись поля CRM → Notion --------------------------------------------

class PushFieldBody(BaseModel):
    field: str
    # Перезаписать, даже если в Notion значение изменилось после последней синхронизации
    # (менеджер осознанно затирает более свежую правку Notion). По умолчанию — защита.
    force: bool = False


def _resolve_push_target(schema: dict, field: str, wanted: str | None, crm_val) -> tuple[str, str, object]:
    """(реальное имя колонки, тип, финальное значение для записи) по схеме Notion.
    Отсекает неписываемые типы и подбирает существующую опцию select. ValueError —
    если колонка не найдена/не пишется/нет подходящей опции. Sync (без сети, кроме
    того, что schema уже загружена вызывающим)."""
    from migration.transformers.normalize import parse_pipeline_status, parse_degree_or_none
    parsers = {"degree": parse_degree_or_none, "pipeline": parse_pipeline_status, "intake": _parse_intake_option}

    if wanted is None:
        real_name, ptype = notion_write.find_title_property(schema)
    else:
        real_name, ptype = notion_write.resolve_property(schema, wanted)
    if real_name is None:
        raise ValueError(f"Колонка не найдена в Notion: {wanted or 'ФИО (title)'}")
    if ptype not in notion_write.WRITABLE_TYPES:
        raise ValueError(f"Колонку Notion «{real_name}» (тип {ptype}) нельзя изменить через API")

    value = crm_val
    if ptype in ("select", "status"):
        parser = parsers.get(_PUSH_SELECT_PARSERS.get(field, ""))
        options = notion_write.select_options(schema, real_name)
        match = next((o for o in options if parser and parser(o) == crm_val), None)
        if match is None:
            raise ValueError(f"В Notion нет подходящей опции для значения «{crm_val}» в «{real_name}»")
        value = match
    elif isinstance(value, date):
        value = value.isoformat()
    elif isinstance(value, Decimal):
        value = float(value)
    return real_name, ptype, value


async def _load_push_context(db: AsyncSession, student_id: uuid.UUID, field: str):
    """Общая проверка+загрузка для preview и записи: (student, snapshot, crm_val).
    Бросает HTTPException при некорректном поле/отсутствии данных."""
    if not notion_sync.is_configured():
        raise HTTPException(status_code=400, detail="Notion не настроен — задай NOTION_API_KEY и NOTION_DATABASE_ID")
    if field not in PUSH_FIELDS:
        raise HTTPException(status_code=400, detail=f"Поле нельзя записать в Notion: {field}")

    student = (await db.execute(select(Student).where(Student.id == student_id))).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    snapshot = (await db.execute(
        select(NotionSnapshot).where(
            NotionSnapshot.student_id == student_id,
            NotionSnapshot.status == NotionMatchStatus.linked,
        ).order_by(NotionSnapshot.synced_at.desc())
    )).scalars().first()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Notion-запись не привязана к студенту")

    contract = await _latest_contract(db, student_id) if field in _PUSH_CONTRACT_FIELDS else None
    crm_val = _crm_push_value(field, student, contract)
    if crm_val in (None, ""):
        raise HTTPException(status_code=400, detail="В CRM нет значения для записи")
    return student, snapshot, crm_val


@router.post("/students/{student_id}/push-field/preview")
async def push_field_preview(
    student_id: uuid.UUID,
    body: PushFieldBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Что именно уйдёт в Notion, без записи: текущее значение в Notion, что станет,
    и флаг conflict — если Notion изменили после последней синхронизации (перезапись
    затрёт более свежую правку). Фронт показывает это в подтверждении."""
    _require_manager(current_user)
    _, snapshot, crm_val = await _load_push_context(db, student_id, body.field)
    field, wanted, page_id = body.field, PUSH_FIELDS[body.field], snapshot.notion_page_id
    snap_current = (snapshot.normalized_data or {}).get(_SNAPSHOT_KEY[field])

    def _preview() -> dict:
        schema = notion_write.get_schema()
        real_name, ptype, value = _resolve_push_target(schema, field, wanted, crm_val)
        notion_current = notion_write.read_value(page_id, real_name)
        return {
            "real_name": real_name, "ptype": ptype,
            "will_write": value,
            "notion_current": notion_current,
            # Notion отличается и от снапшота (значит, кто-то поменял его после синка).
            "conflict": _conflict_norm(field, notion_current) != _conflict_norm(field, snap_current),
        }

    try:
        preview = await asyncio.get_event_loop().run_in_executor(None, _preview)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Ошибка чтения Notion: {exc}")
    return {"ok": True, "field": field, **preview}


@router.post("/students/{student_id}/push-field")
async def push_field(
    student_id: uuid.UUID,
    body: PushFieldBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Записать значение поля из CRM в привязанную запись Notion (обратное к apply_field).
    Только whitelisted-поля, только по действию менеджера, каждая запись — в аудит.
    Формульные/rollup-колонки отсекаются по типу из схемы Notion. Перед записью —
    проверка конфликта (Notion не меняли после синка), после — верификация записи."""
    _require_manager(current_user)
    student, snapshot, crm_val = await _load_push_context(db, student_id, body.field)

    field, wanted, page_id, force = body.field, PUSH_FIELDS[body.field], snapshot.notion_page_id, body.force
    snap_key = _SNAPSHOT_KEY[field]
    snap_current = (snapshot.normalized_data or {}).get(snap_key)

    def _write():
        """Блокирующие обращения к Notion API — уводим в thread pool."""
        schema = notion_write.get_schema()
        real_name, ptype, value = _resolve_push_target(schema, field, wanted, crm_val)
        # Optimistic concurrency: если в Notion значение отличается от снапшота, кто-то
        # изменил его после синка — не затираем вслепую, требуем force (осознанно).
        notion_current = notion_write.read_value(page_id, real_name)
        if not force and _conflict_norm(field, notion_current) != _conflict_norm(field, snap_current):
            raise _Conflict(real_name, notion_current)
        # update_page сам перечитает и сверит, что запись принялась (verify=True).
        notion_write.update_page(page_id, {real_name: notion_write.build_property(ptype, value)})
        return value

    loop = asyncio.get_event_loop()
    try:
        written = await loop.run_in_executor(None, _write)
    except _Conflict as exc:
        raise HTTPException(
            status_code=409,
            detail=f"В Notion «{exc.real_name}» уже другое значение ({exc.current!r}) — его изменили "
                   f"после последней синхронизации. Обнови сверку или подтверди перезапись.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001 — сетевые/API-ошибки Notion наружу как 502
        raise HTTPException(status_code=502, detail=f"Ошибка записи в Notion: {exc}")

    # Аудит: старое = значение в снапшоте Notion, новое = записанное из CRM.
    data = dict(snapshot.normalized_data or {})
    old_notion = data.get(snap_key)
    await log_change(
        db, "notion", student.id, f"notion_push:{field}",
        str(old_notion) if old_notion is not None else None,
        str(written) if written is not None else None,
        str(current_user.id), "notion_push",
    )

    # Обновляем снапшот, чтобы сверка сразу показала совпадение (не ждать автосинка).
    data[snap_key] = written
    snapshot.normalized_data = data

    # Стороны сравнялись (в Notion записано CRM-значение) — фиксируем эталон.
    _record_baseline(snapshot, field, student, None)

    await db.commit()
    return {"ok": True, "field": field, "written": str(written)}


class _Conflict(Exception):
    """Notion изменили после синка — перезапись затрёт чужую правку (нужен force)."""
    def __init__(self, real_name: str, current):
        self.real_name = real_name
        self.current = current
        super().__init__(real_name)
