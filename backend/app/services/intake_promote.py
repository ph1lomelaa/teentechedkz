"""Превращение строк Google-форм (intake_submissions) в карточки студентов.

Живёт отдельно от `api/v1/endpoints/sync.py` потому, что этим занимаются двое:
ручка «Создать карточки из новых анкет» и автоматический проход после каждого
синка (`services/sheets_sync.py`). Зависимость строго в одну сторону — этот
модуль не знает ни про эндпоинты, ни про `sheets_sync`, иначе получается цикл
импорта (`sync.py` уже импортирует `sheets_sync`).

Переносятся ТОЛЬКО безопасные поля профиля. Суммы договора и личные
договорённости остаются в анкете — их вносит менеджер руками.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.models import IntakeSubmission, IntakeSource, IntakeStatus, Student
from app.services.default_services import ensure_default_services
from app.services.sheets_sync import map_row

logger = logging.getLogger(__name__)

# Совпадение выше этого порога считаем «тот же человек» и карточку не создаём —
# вместо дубля анкета получает кандидата на ручную привязку.
DUPLICATE_CONFIDENCE = 0.9

# Кем подписывается запись в истории, когда карточку создал не человек, а синк.
# `status_history.changed_by` — обычная строка, не внешний ключ, поэтому здесь
# допустимо имя процесса вместо id пользователя.
AUTO_ACTOR = "sheets_sync"

# Потолок на один проход. Нужен из-за первого запуска: в staging лежит весь
# накопленный backlog анкет, и без потолка первый же автоматический проход
# создал бы разом сотни студентов (каждый — плюс услуги и заявки по странам)
# одной транзакцией, без человека рядом. Синк повторяется каждые
# SHEETS_SYNC_INTERVAL_SECONDS, поэтому остаток разбирается следующими
# проходами — очередь всё равно уходит за минуты, но порциями.
MAX_PER_RUN = 100


def norm_cmp(v: str | None) -> str:
    return " ".join(str(v or "").lower().split())


def parse_intake_year(raw) -> int | None:
    for token in str(raw or "").replace(".", " ").split():
        if token.isdigit() and 2020 <= int(token) <= 2035:
            return int(token)
    return None


def service_included_from_answer(field: str, v) -> bool | None:
    """Интерпретация ответа менеджера по услуге из свободного текста."""
    t = norm_cmp(v)
    if not t:
        return None
    if t in ("не включена", "-", "нет", "no", "none", "nan"):
        return False
    if t in ("включена", "да", "yes", "true", "1", "+", "есть"):
        return True
    if t.startswith(("нет", "no", "не ")):
        return False

    if field == "svc_ielts_mock":
        if "немец" in t and not any(x in t for x in ("ielts", "айлтс", "мок", "mock")):
            return False
        if "подготов" in t and not any(x in t for x in ("мок", "mock")):
            return False
        return any(x in t for x in ("мок", "mock", "ielts mock", "айлтс мок"))

    if field == "svc_ielts_prep":
        if "немец" in t and not any(x in t for x in ("ielts", "айлтс")):
            return False
        return not t.startswith(("нет", "no", "не "))

    if field == "svc_portfolio":
        if any(x in t for x in ("все", "all")):
            return True
        return any(token.isdigit() and int(token) > 0 for token in t.replace(",", " ").split())

    return not t.startswith(("нет", "no", "не "))


def portfolio_directions_count(v) -> int | None:
    t = norm_cmp(v)
    if any(x in t for x in ("все", "all")):
        return 4
    for token in t.replace(",", " ").split():
        if token.isdigit() and int(token) > 0:
            return int(token)
    return None


def backfill_student_fields(student: Student, mapped: dict) -> list[str]:
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


async def apply_intake_countries(db: AsyncSession, student: Student, mapped: dict) -> int:
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


async def apply_intake_services(db: AsyncSession, student: Student, mapped: dict) -> int:
    """Обновляет услуги только из package-анкеты менеджера.

    Стоимость сопровождения и договорённости остаются ручными полями.
    """
    from app.models.service import Service, ServiceStatus, ServiceType

    svc_map = {
        "svc_proforientation": ServiceType.proforientation,
        "svc_ielts_mock": ServiceType.ielts_mock,
        "svc_ielts_prep": ServiceType.ielts_prep,
        "svc_sat_prep": ServiceType.sat_prep,
        "svc_portfolio": ServiceType.portfolio_improvement,
    }

    changed = 0
    for field, svc_type in svc_map.items():
        if field not in mapped:
            continue
        included = service_included_from_answer(field, mapped.get(field))
        if included is None:
            continue

        # uq_services_student_service_type гарантирует не больше одной строки
        # на тип (миграция 066); раньше здесь брали .all()[0] в обход
        # MultipleResultsFound из-за дубликатов после слияния студентов.
        existing = (await db.execute(
            select(Service).where(
                Service.student_id == student.id,
                Service.service_type == svc_type,
            )
        )).scalar_one_or_none()

        if existing:
            if existing.included != included:
                existing.included = included
                changed += 1
            if svc_type == ServiceType.portfolio_improvement and included and not existing.portfolio_directions_count:
                existing.portfolio_directions_count = portfolio_directions_count(mapped.get(field))
        else:
            extra = {}
            if svc_type == ServiceType.portfolio_improvement and included:
                extra["portfolio_directions_count"] = portfolio_directions_count(mapped.get(field))
            db.add(Service(
                student_id=student.id,
                service_type=svc_type,
                included=included,
                status=ServiceStatus.not_started,
                **extra,
            ))
            changed += 1
    return changed


async def create_student_from_intake(
    db: AsyncSession, submission: IntakeSubmission, actor_id: uuid.UUID | None
) -> Student:
    """Создать карточку студента из анкеты и пометить анкету привязанной.

    Договор намеренно не создаётся: у такой карточки `pipeline_status` остаётся
    пустым, и в общей базе она честно видна как «без статуса» — менеджер
    проставит его сам, когда сверит данные.
    """
    from migration.transformers.normalize import parse_degree

    source = submission.source
    headers = list(submission.raw_data.keys())
    values = [submission.raw_data[h] for h in headers]
    mapped = map_row(headers, values, source)

    student = Student(
        full_name=(submission.full_name or "Без имени")[:500],
        phone=mapped.get("phone", "")[:100],
        degree_level=parse_degree(mapped.get("degree_level", "")),
        intake_year=parse_intake_year(mapped.get("intake_year")) or datetime.now(timezone.utc).year + 1,
    )
    db.add(student)
    await db.flush()

    await ensure_default_services(db, student.id)

    backfill_student_fields(student, mapped)
    await apply_intake_countries(db, student, mapped)
    if source == IntakeSource.package:
        await apply_intake_services(db, student, mapped)

    submission.student_id = student.id
    submission.status = IntakeStatus.linked
    submission.linked_by = actor_id
    submission.linked_at = datetime.now(timezone.utc)

    await log_change(
        db, "student", student.id, "created_from_intake",
        None, f"{source.value}:{submission.id}",
        str(actor_id) if actor_id else AUTO_ACTOR, "sheets_sync",
    )
    return student


async def promote_new_submissions(
    db: AsyncSession, *, actor_id: uuid.UUID | None, limit: int = MAX_PER_RUN
) -> dict:
    """Создать студентов из всех новых анкет БЕЗ кандидата на привязку.

    Каждая анкета перепроверяется транслит-матчем: при найденном похожем
    студенте карточка не создаётся, а анкета получает кандидата — так
    повторный прогон не плодит дубли.

    Коммит остаётся на вызывающем: ручка коммитит сама, а синк — вместе с
    остальной своей работой.
    """
    from migration.transformers.match import fuzzy_match
    from app.services.sheets_sync import load_students_index

    result = await db.execute(
        select(IntakeSubmission)
        .where(
            IntakeSubmission.status == IntakeStatus.new,
            IntakeSubmission.suggested_student_id.is_(None),
        )
        # Старые анкеты первыми: очередь должна разбираться по-честному, а не
        # с конца, иначе самые давние заявки остаются невидимыми дольше всех.
        .order_by(IntakeSubmission.created_at)
        .limit(limit)
        # Блокировка строк, а не `asyncio.Lock`: автоматический проход живёт в
        # процессе worker, а кнопки «Синхронизировать» и «Создать из анкет» —
        # в процессах uvicorn (их ещё и несколько). Лок в памяти между ними не
        # работает вовсе, и два одновременных прохода прочитали бы одни и те же
        # анкеты и создали бы по студенту каждый — дубли молча, без ошибки.
        # SKIP LOCKED, а не ожидание: занятые кем-то строки просто достаются
        # следующему проходу, и кнопка не висит, пока синк разбирает очередь.
        .with_for_update(skip_locked=True)
    )
    submissions = result.scalars().all()
    students_index = await load_students_index(db)

    created = skipped = 0
    for submission in submissions:
        match = fuzzy_match(
            submission.full_name or "", submission.phone_normalized or "", students_index
        )
        if match.student_id and match.confidence >= DUPLICATE_CONFIDENCE:
            submission.suggested_student_id = match.student_id
            submission.suggested_confidence = round(match.confidence, 3)
            skipped += 1
            continue
        student = await create_student_from_intake(db, submission, actor_id)
        # вторая анкета того же человека в этом прогоне не должна создать дубль
        students_index.append({
            "id": student.id, "full_name": student.full_name,
            "phone": student.phone, "intake_year": student.intake_year,
            "user_id": student.user_id,
        })
        created += 1

    # `has_more` — признак, что проход упёрся в потолок и очередь не пуста.
    # Без него и кнопка, и статус синка врали бы «всё разобрано».
    return {"created": created, "skipped": skipped, "has_more": len(submissions) == limit}
