"""Синк Google-форм и работа с входящими анкетами (intake_submissions)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.deps import CurrentUser
from app.core.audit import log_change
from app.models import IntakeSubmission, IntakeSource, IntakeStatus, Student
from app.models.user import UserRole
from app.services import sheets_sync
from app.services.intake_ai_check import check_same_meaning
from app.services.default_services import ensure_default_services
from app.services.sheets_sync import map_row, PACKAGE_FIELD_PATTERNS, CASES_FIELD_PATTERNS  # noqa: F401

router = APIRouter(prefix="/sync", tags=["sync"])

_MANAGE_ROLES = (UserRole.admin, UserRole.mzk_manager)


def _require_manager(user) -> None:
    if user.role not in _MANAGE_ROLES:
        raise HTTPException(status_code=403, detail="Недостаточно прав")


def _submission_to_dict(s: IntakeSubmission) -> dict:
    return {
        "id": str(s.id),
        "source": s.source.value,
        "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
        "full_name": s.full_name,
        "phone_normalized": s.phone_normalized,
        "manager_name": s.manager_name,
        "suggested_student_id": str(s.suggested_student_id) if s.suggested_student_id else None,
        "suggested_student_name": s.suggested_student.full_name if s.suggested_student else None,
        "suggested_confidence": s.suggested_confidence,
        "student_id": str(s.student_id) if s.student_id else None,
        "status": s.status.value,
        "raw_data": s.raw_data,
        "created_at": s.created_at.isoformat(),
    }


@router.post("/run")
async def run_sync_now(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Только администратор может запускать синхронизацию")
    try:
        counters = await sheets_sync.run_sync(db)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка синка: {e}")
    return {"ok": True, "counters": counters}


@router.get("/status")
async def sync_status(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    return {
        "configured": sheets_sync.is_configured(),
        "last_run": sheets_sync.last_run,
        "new_submissions": await sheets_sync.new_submissions_count(db),
    }


@router.get("/submissions")
async def list_submissions(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
    status: str | None = Query(default="new"),
    source: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
):
    _require_manager(current_user)
    query = select(IntakeSubmission).options(joinedload(IntakeSubmission.suggested_student))
    count_query = select(func.count()).select_from(IntakeSubmission)

    if status and status != "all":
        query = query.where(IntakeSubmission.status == IntakeStatus(status))
        count_query = count_query.where(IntakeSubmission.status == IntakeStatus(status))
    if source:
        query = query.where(IntakeSubmission.source == IntakeSource(source))
        count_query = count_query.where(IntakeSubmission.source == IntakeSource(source))

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(
        query.order_by(IntakeSubmission.submitted_at.desc().nullslast())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = result.scalars().unique().all()
    return {
        "items": [_submission_to_dict(s) for s in items],
        "total": total,
        "page": page,
        "pages": max(1, -(-total // size)),
    }


async def _load_submission(db: AsyncSession, submission_id: uuid.UUID) -> IntakeSubmission:
    result = await db.execute(
        select(IntakeSubmission)
        .options(joinedload(IntakeSubmission.suggested_student))
        .where(IntakeSubmission.id == submission_id)
    )
    submission = result.scalars().first()
    if not submission:
        raise HTTPException(status_code=404, detail="Анкета не найдена")
    return submission


class LinkBody(BaseModel):
    student_id: uuid.UUID


class BulkLinkBody(BaseModel):
    status: str = "new"
    source: str | None = None


@router.post("/submissions/{submission_id}/link")
async def link_submission(
    submission_id: uuid.UUID,
    body: LinkBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_manager(current_user)
    submission = await _load_submission(db, submission_id)

    student = (
        await db.execute(
            select(Student).where(Student.id == body.student_id, Student.is_archived == False)  # noqa: E712
        )
    ).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден или архивирован")

    submission.student_id = student.id
    submission.status = IntakeStatus.linked
    submission.linked_by = current_user.id
    submission.linked_at = datetime.now(timezone.utc)

    mapped = map_row(list(submission.raw_data.keys()), list(submission.raw_data.values()), submission.source)
    changed = _backfill_student_fields(student, mapped)
    added_countries = await _apply_intake_countries(db, student, mapped)
    if changed or added_countries:
        detail = ", ".join(changed) + (f" + страны: {added_countries}" if added_countries else "")
        await log_change(db, "student", student.id, "filled_from_intake", None, detail, str(current_user.id), "sheets_sync")

    await log_change(
        db, "student", student.id, "intake_submission_linked",
        None, f"{submission.source.value}:{submission.id}", str(current_user.id), "sheets_sync",
    )
    await db.commit()
    return _submission_to_dict(submission)


@router.post("/submissions/link-all")
async def link_all_submissions(
    body: BulkLinkBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_manager(current_user)

    query = (
        select(IntakeSubmission)
        .options(joinedload(IntakeSubmission.suggested_student))
        .join(Student, Student.id == IntakeSubmission.suggested_student_id)
        .where(Student.is_archived == False)  # noqa: E712
    )
    if body.status and body.status != "all":
        query = query.where(IntakeSubmission.status == IntakeStatus(body.status))
    if body.source:
        query = query.where(IntakeSubmission.source == IntakeSource(body.source))
    query = query.where(IntakeSubmission.status == IntakeStatus.new, IntakeSubmission.suggested_student_id.isnot(None))

    result = await db.execute(query)
    submissions = result.scalars().unique().all()

    linked = 0
    skipped = 0
    for submission in submissions:
        if not submission.suggested_student_id:
            skipped += 1
            continue
        submission.student_id = submission.suggested_student_id
        submission.status = IntakeStatus.linked
        submission.linked_by = current_user.id
        submission.linked_at = datetime.now(timezone.utc)

        if submission.suggested_student:
            mapped = map_row(list(submission.raw_data.keys()), list(submission.raw_data.values()), submission.source)
            _backfill_student_fields(submission.suggested_student, mapped)
            await _apply_intake_countries(db, submission.suggested_student, mapped)

        if submission.student_id:
            await log_change(
                db,
                "student",
                submission.student_id,
                "intake_submission_linked",
                None,
                f"{submission.source.value}:{submission.id}",
                str(current_user.id),
                "sheets_sync",
            )
        linked += 1

    await db.commit()
    return {"ok": True, "linked": linked, "skipped": skipped}


@router.post("/submissions/{submission_id}/ignore")
async def ignore_submission(
    submission_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    _require_manager(current_user)
    submission = await _load_submission(db, submission_id)
    submission.status = IntakeStatus.ignored
    submission.linked_by = current_user.id
    submission.linked_at = datetime.now(timezone.utc)
    await db.commit()
    return _submission_to_dict(submission)


@router.post("/submissions/{submission_id}/create-student")
async def create_student_from_submission(
    submission_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Создать студента из анкеты. Переносятся ТОЛЬКО безопасные поля профиля.
    Суммы договора и договорённости остаются в анкете — менеджер вносит их вручную."""
    _require_manager(current_user)
    submission = await _load_submission(db, submission_id)
    if submission.status != IntakeStatus.new:
        raise HTTPException(status_code=400, detail="Анкета уже обработана")

    # Защита от дублей: имя могло быть написано на другом языке — проверяем
    # транслит-матчем по свежему списку студентов, а не только по кандидату синка
    from migration.transformers.match import fuzzy_match
    from app.services.sheets_sync import _load_students_index

    students_index = await _load_students_index(db)
    raw_phone = ""
    for key, value in submission.raw_data.items():
        if "телефон" in str(key).lower():
            raw_phone = str(value)
            break
    match = fuzzy_match(submission.full_name or "", raw_phone, students_index)
    if match.student_id and match.confidence >= 0.9:
        existing = next((s for s in students_index if s["id"] == match.student_id), None)
        raise HTTPException(
            status_code=409,
            detail=f"Похоже, студент уже есть в CRM: «{existing['full_name'] if existing else ''}». "
                   f"Используй «Привязать» вместо создания, чтобы не было дубля.",
        )

    student = await _create_student_from_intake(db, submission, current_user.id)
    await db.commit()
    return {"student_id": str(student.id), "submission": _submission_to_dict(submission)}


def _parse_intake_year(raw) -> int | None:
    for token in str(raw or "").replace(".", " ").split():
        if token.isdigit() and 2020 <= int(token) <= 2035:
            return int(token)
    return None


def _backfill_student_fields(student: Student, mapped: dict) -> list[str]:
    """Дозаполняет ТОЛЬКО пустые поля профиля значениями из анкеты — никогда
    не перезаписывает то, что уже внесено вручную или из другой анкеты того
    же студента (Пакет и Кейс приходят в разное время и дополняют друг друга)."""
    changed: list[str] = []

    def backfill(attr: str, value):
        if not value or getattr(student, attr):
            return
        setattr(student, attr, value)
        changed.append(attr)

    backfill("city", mapped.get("city"))
    backfill("specialty", mapped.get("specialty"))
    backfill("gpa", mapped.get("gpa"))
    backfill("achievements_text", mapped.get("achievements"))
    backfill("budget_per_year", mapped.get("budget"))
    backfill("phone", mapped.get("phone"))

    raw_age = str(mapped.get("age", "")).split(".")[0]
    if raw_age.isdigit() and 10 <= int(raw_age) <= 80 and not student.age:
        student.age = int(raw_age)
        changed.append("age")

    return changed


async def _apply_intake_countries(db: AsyncSession, student: Student, mapped: dict) -> int:
    """Создаёт заявки (Application) по странам из анкеты, которых ещё нет у студента в CRM."""
    from migration.transformers.normalize import countries_set
    from app.models import Application

    raw = mapped.get("countries")
    if not raw:
        return 0

    existing = {
        c.strip().lower()
        for c in (await db.execute(
            select(Application.country).where(Application.student_id == student.id)
        )).scalars().all()
        if c
    }

    added = 0
    for country in sorted(countries_set(raw)):
        key = country.strip().lower()
        if not key or key in existing:
            continue
        db.add(Application(student_id=student.id, country=country, is_primary=not existing))
        existing.add(key)
        added += 1
    return added


async def _create_student_from_intake(db: AsyncSession, submission: IntakeSubmission, user_id: uuid.UUID) -> Student:
    from migration.transformers.normalize import parse_degree

    source = submission.source
    headers = list(submission.raw_data.keys())
    values = [submission.raw_data[h] for h in headers]
    mapped = map_row(headers, values, source)

    student = Student(
        full_name=(submission.full_name or "Без имени")[:500],
        phone=mapped.get("phone", "")[:100],
        degree_level=parse_degree(mapped.get("degree_level", "")),
        intake_year=_parse_intake_year(mapped.get("intake_year")) or datetime.now(timezone.utc).year + 1,
    )
    db.add(student)
    await db.flush()

    await ensure_default_services(db, student.id)

    _backfill_student_fields(student, mapped)
    await _apply_intake_countries(db, student, mapped)

    submission.student_id = student.id
    submission.status = IntakeStatus.linked
    submission.linked_by = user_id
    submission.linked_at = datetime.now(timezone.utc)

    await log_change(
        db, "student", student.id, "created_from_intake",
        None, f"{source.value}:{submission.id}", str(user_id), "sheets_sync",
    )
    return student


@router.post("/submissions/create-missing")
async def create_missing_from_intake(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Создать студентов из всех новых анкет БЕЗ кандидата на привязку.
    Каждая анкета перепроверяется транслит-матчем — при найденном похожем
    студенте запись пропускается и получает кандидата вместо дубля."""
    _require_manager(current_user)

    from migration.transformers.match import fuzzy_match
    from app.services.sheets_sync import _load_students_index

    result = await db.execute(
        select(IntakeSubmission).where(
            IntakeSubmission.status == IntakeStatus.new,
            IntakeSubmission.suggested_student_id.is_(None),
        )
    )
    submissions = result.scalars().all()
    students_index = await _load_students_index(db)

    created = skipped = 0
    for submission in submissions:
        match = fuzzy_match(
            submission.full_name or "", submission.phone_normalized or "", students_index
        )
        if match.student_id and match.confidence >= 0.9:
            submission.suggested_student_id = match.student_id
            submission.suggested_confidence = round(match.confidence, 3)
            skipped += 1
            continue
        student = await _create_student_from_intake(db, submission, current_user.id)
        # вторая анкета того же человека в этом прогоне не должна создать дубль
        students_index.append({
            "id": student.id, "full_name": student.full_name,
            "phone": student.phone, "intake_year": student.intake_year,
        })
        created += 1

    await db.commit()
    return {"ok": True, "created": created, "skipped": skipped}


# --- Сверка анкет по студенту ------------------------------------------------

_SERVICE_ROWS = [
    ("svc_proforientation", "Профориентация"),
    ("svc_ielts_mock", "IELTS Mock"),
    ("svc_ielts_prep", "Подготовка IELTS"),
    ("svc_sat_prep", "Подготовка SAT"),
    ("svc_portfolio", "Портфолио (направления)"),
]


def _norm_cmp(v: str | None) -> str:
    return " ".join(str(v or "").lower().split())


def _norm_year(v: str | None) -> str:
    for token in str(v or "").replace(".", " ").split():
        if token.isdigit() and 2020 <= int(token) <= 2035:
            return token
    return _norm_cmp(v)


_FIELD_NORMALIZERS: dict = {}


def _norm_degree_for_compare(v: str | None) -> str:
    """Токены ступеней вместо посимвольного сравнения: «Фаудшейшн+ бакалавр» и
    «Foundation + Бакалавриат» дают одинаковый набор {foundation, undergraduate}.
    Нераспознанный текст возвращается как есть — две разные непонятные строки
    не должны случайно «совпасть»."""
    from migration.transformers.normalize import degree_tokens

    toks = degree_tokens(v or "")
    if toks:
        return " ".join(sorted(toks))
    return str(v or "").strip().lower()


def _get_normalizers() -> dict:
    """Поле → функция нормализации перед сравнением менеджер↔студент."""
    if not _FIELD_NORMALIZERS:
        from migration.transformers.normalize import normalize_phone

        _FIELD_NORMALIZERS.update({
            "phone": lambda v: normalize_phone(str(v or "").removesuffix(".0")),
            "degree_level": _norm_degree_for_compare,
            "intake_year": _norm_year,
        })
    return _FIELD_NORMALIZERS


def _svc_truthy(v) -> bool:
    """Значение услуги → есть/нет: «Нет, будут покупать тоефл» → нет,
    «Есть, по англ» / «Медицина» → есть."""
    t = _norm_cmp(v)
    if not t or t in ("не включена", "-", "нет"):
        return False
    if t == "включена":
        return True
    return not t.startswith(("нет", "no", "не "))


def _values_same(field: str, a, b) -> bool:
    """Совпадают ли значения поля. ФИО — транслит-сравнение («Сыбан Еркенур
    Даниярқызы» ↔ «Syban Yerkenur»); страны — по множеству с допуском на
    подмножество («Италия» ↔ «Италия (1), Корея (1)» — анкета может называть
    не все страны); услуги — по смыслу «есть/нет»; остальное — нормализатор поля."""
    from migration.transformers.normalize import names_probably_same, countries_set

    if field == "full_name":
        return names_probably_same(str(a), str(b)) or _norm_cmp(a) == _norm_cmp(b)
    if field == "countries":
        sa, sb = countries_set(str(a)), countries_set(str(b))
        return bool(sa) and bool(sb) and (sa <= sb or sb <= sa)
    if field.startswith("svc_"):
        return _svc_truthy(a) == _svc_truthy(b)
    norm = _get_normalizers().get(field, _norm_cmp)
    return norm(a) == norm(b)


@router.get("/students/{student_id}/intake")
async def student_intake(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """Обе анкеты студента + построчная сверка «менеджер | студент | CRM»."""
    _require_manager(current_user)

    student = (
        await db.execute(
            select(Student)
            .options(joinedload(Student.applications), joinedload(Student.services))
            .where(Student.id == student_id)
        )
    ).scalars().first()
    if not student:
        raise HTTPException(status_code=404, detail="Студент не найден")

    result = await db.execute(
        select(IntakeSubmission).where(
            IntakeSubmission.student_id == student_id,
            IntakeSubmission.status == IntakeStatus.linked,
        ).order_by(IntakeSubmission.submitted_at.desc().nullslast())
    )
    submissions = result.scalars().all()
    package = next((s for s in submissions if s.source == IntakeSource.package), None)
    cases = next((s for s in submissions if s.source == IntakeSource.cases), None)

    def mapped_of(sub: IntakeSubmission | None) -> dict:
        if not sub:
            return {}
        headers = list(sub.raw_data.keys())
        values = [sub.raw_data[h] for h in headers]
        return map_row(headers, values, sub.source)

    pkg = mapped_of(package)
    cs = mapped_of(cases)

    crm_countries = ", ".join(
        f"{a.country} ({a.submissions_planned})" for a in (student.applications or [])
    ) or None
    crm_services = {
        s.service_type.value if hasattr(s.service_type, "value") else str(s.service_type): s
        for s in (student.services or [])
    }

    def clean(v) -> str | None:
        """Косметика значений из форм: '2027.0' → '2027', обрезка пробелов."""
        if v is None:
            return None
        s = " ".join(str(v).split())
        if not s:
            return None
        if s.endswith(".0") and s[:-2].isdigit():
            s = s[:-2]
        return s

    _DEGREE_RU = {
        "undergraduate": "Бакалавриат",
        "masters": "Магистратура",
        "foundation": "Foundation",
        "found_ug": "Foundation + Бакалавриат",
    }

    async def row(field: str, label: str, pkg_v, cs_v, crm_v, comparable: bool = False, human_only: bool = False) -> dict:
        mismatch = None
        if comparable and pkg_v and cs_v:
            mismatch = not _values_same(field, pkg_v, cs_v)

        # Whether the CRM value matches what's in the forms — must use the
        # same field-aware comparison as above (phone/year/degree/имена/страны),
        # not a raw string compare: "+7 (925) 916-11-05" and "79259161105" are
        # the same number, but look different letter-for-letter.
        form_v = pkg_v or cs_v
        crm_matches = _values_same(field, form_v, crm_v) if (form_v and crm_v) else None

        ai_same_meaning = None
        ai_note = None
        if mismatch and pkg_v and cs_v:
            ai_same_meaning, ai_note = await check_same_meaning(db, student.id, field, label, str(pkg_v), str(cs_v))

        crm_ai_same_meaning = None
        crm_ai_note = None
        if crm_matches is False:
            crm_ai_same_meaning, crm_ai_note = await check_same_meaning(
                db, student.id, field, label, str(form_v), str(crm_v)
            )

        return {
            "field": field, "label": label,
            "package": clean(pkg_v), "cases": clean(cs_v), "crm": clean(crm_v),
            "mismatch": mismatch, "human_only": human_only,
            "crm_matches": crm_matches,
            "crm_ai_same_meaning": crm_ai_same_meaning, "crm_ai_note": crm_ai_note,
            "ai_same_meaning": ai_same_meaning, "ai_note": ai_note,
        }

    crm_degree = _DEGREE_RU.get(
        student.degree_level.value if student.degree_level else "", None
    )

    comparison = [
        await row("full_name", "ФИО", pkg.get("full_name"), cs.get("full_name"), student.full_name, comparable=True),
        await row("phone", "Телефон", pkg.get("phone"), cs.get("phone"), student.phone, comparable=True),
        await row("intake_year", "Год поступления", pkg.get("intake_year"), cs.get("intake_year"), str(student.intake_year), comparable=True),
        await row("degree_level", "Ступень", pkg.get("degree_level"), cs.get("degree_level"), crm_degree, comparable=True),
        await row("city", "Город", None, cs.get("city"), student.city),
        await row("age", "Возраст", None, cs.get("age"), str(student.age) if student.age else None),
        await row("specialty", "Специальность", None, cs.get("specialty"), student.specialty),
        await row("gpa", "GPA", None, cs.get("gpa"), student.gpa),
        await row("budget", "Бюджет (в год)", None, cs.get("budget"), student.budget_per_year),
        await row("english_level", "IELTS / английский", None, cs.get("english_level"), None),
        await row("sat_level", "SAT / GMAT / GRE", None, cs.get("sat_level"), None),
        await row("achievements", "Достижения", None, cs.get("achievements"), student.achievements_text),
        await row("countries", "Страны поступления", pkg.get("countries"), cs.get("countries"), crm_countries, comparable=True),
    ]

    # Услуги приходят только из анкеты менеджера — без неё эти строки лишние
    if package:
        from app.models.service import ServiceStatus

        for key, label in _SERVICE_ROWS:
            service_type = key.removeprefix("svc_").replace("portfolio", "portfolio_improvement")
            crm_svc = crm_services.get(service_type)
            crm_v = None
            if crm_svc is not None:
                # Услуга «есть», если стоит галочка ИЛИ по ней уже идёт работа —
                # в старых данных флаг included часто не проставлен
                active = crm_svc.included or crm_svc.status not in (
                    ServiceStatus.not_started, ServiceStatus.not_applicable
                ) or bool(crm_svc.result)
                crm_v = "включена" if active else "не включена"
            comparison.append(await row(key, label, pkg.get(key), None, crm_v))

        # Human-only: показываем, но никогда не применяем автоматически
        comparison.append(
            await row("contract_amount", "Стоимость сопровождения", pkg.get("contract_amount"), None, None, human_only=True)
        )

    if pkg.get("agreements") or cs.get("agreements"):
        comparison.append(
            await row("agreements", "Договорённости", pkg.get("agreements"), cs.get("agreements"),
                "см. конфиденциальные заметки", comparable=True, human_only=True)
        )

    # Полностью пустые строки — шум
    comparison = [r for r in comparison if r["package"] or r["cases"] or r["crm"]]

    return {
        "package": _submission_to_dict(package) if package else None,
        "cases": _submission_to_dict(cases) if cases else None,
        "comparison": comparison,
    }


@router.get("/overview")
async def intake_overview(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: CurrentUser,
):
    """{student_id: {has_package, has_cases}} — индикаторы для списка студентов."""
    result = await db.execute(
        select(IntakeSubmission.student_id, IntakeSubmission.source).where(
            IntakeSubmission.status == IntakeStatus.linked,
            IntakeSubmission.student_id.isnot(None),
        )
    )
    overview: dict[str, dict] = {}
    for student_id, source in result.all():
        entry = overview.setdefault(str(student_id), {"has_package": False, "has_cases": False})
        if source == IntakeSource.package:
            entry["has_package"] = True
        else:
            entry["has_cases"] = True
    return overview
