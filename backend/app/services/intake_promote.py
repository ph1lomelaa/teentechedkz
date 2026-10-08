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
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.models import IntakeSubmission, IntakeSource, IntakeStatus, Student, BackgroundJob
from app.services.default_services import ensure_default_services
from app.services.sheets_sync import map_row

logger = logging.getLogger(__name__)

# Кем подписывается запись в истории, когда карточку создал не человек, а синк.
# `status_history.changed_by` — обычная строка, не внешний ключ, поэтому здесь
# допустимо имя процесса вместо id пользователя.
AUTO_ACTOR = "sheets_sync"

# Потолок на количество созданных/привязанных строк за один проход.
# Primary rows are locked in this batch; at most one paired response is locked
# for each primary row.
MAX_PER_RUN = 100
AUTO_CREATE_WAIT = timedelta(hours=24)


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


async def link_submission_to_student(
    db: AsyncSession, submission: IntakeSubmission, student: Student, *, actor_id: uuid.UUID | None
) -> None:
    """Apply the existing intake link/backfill rules for an automatic strong match."""
    if submission.status != IntakeStatus.new:
        return
    headers = list(submission.raw_data.keys())
    mapped = map_row(headers, [submission.raw_data[h] for h in headers], submission.source)
    changed = backfill_student_fields(student, mapped)
    added_countries = await apply_intake_countries(db, student, mapped)
    changed_services = 0
    if submission.source == IntakeSource.package:
        changed_services = await apply_intake_services(db, student, mapped)

    submission.student_id = student.id
    submission.suggested_student_id = student.id
    submission.status = IntakeStatus.linked
    submission.linked_by = actor_id
    submission.linked_at = datetime.now(timezone.utc)
    submission.identity_review_required = False
    if changed or added_countries or changed_services:
        detail = ", ".join(changed)
        detail += f" + страны: {added_countries}" if added_countries else ""
        detail += f" + услуги: {changed_services}" if changed_services else ""
        await log_change(
            db, "student", student.id, "filled_from_intake", None, detail,
            str(actor_id) if actor_id else AUTO_ACTOR, "sheets_sync",
        )
    await log_change(
        db, "student", student.id, "intake_submission_linked", None,
        f"{submission.source.value}:{submission.id}",
        str(actor_id) if actor_id else AUTO_ACTOR, "sheets_sync",
    )


async def promote_new_submissions(
    db: AsyncSession, *, actor_id: uuid.UUID | None, limit: int = MAX_PER_RUN,
    automatic: bool = False, sheets_completed_at: datetime | None = None,
) -> dict:
    """Создать студентов из всех новых анкет БЕЗ кандидата на привязку.

    Каждая анкета перепроверяется транслит-матчем: при найденном похожем
    студенте карточка не создаётся, а анкета получает кандидата — так
    повторный прогон не плодит дубли.

    Коммит остаётся на вызывающем: ручка коммитит сама, а синк — вместе с
    остальной своей работой.
    """
    from app.services.sheets_sync import load_students_index
    from app.services.intake_identity import (
        plausible_student_candidates, is_strong_unique_name_match, pair_cross_source_submissions,
    )

    notion_completed_at = None
    if automatic:
        from app.core.config import settings
        if (
            not settings.ENABLE_INTAKE_AUTO_CREATE
            and not settings.ENABLE_INTAKE_AUTO_LINK
        ):
            return {"created": 0, "linked": 0, "skipped": 0, "waiting": 0, "has_more": False}
        if sheets_completed_at is None:
            return {"created": 0, "skipped": 0, "waiting": 0, "has_more": False}
        notion_job = (await db.execute(
            select(BackgroundJob).where(BackgroundJob.kind == "notion_sync_status")
        )).scalars().first()
        if notion_job and notion_job.status == "done":
            notion_completed_at = notion_job.finished_at

    universe_result = await db.execute(
        select(IntakeSubmission)
        .where(IntakeSubmission.status == IntakeStatus.new)
        .order_by(IntakeSubmission.created_at)
    )
    candidate_universe = universe_result.scalars().all()
    pair_map = pair_cross_source_submissions(candidate_universe)

    query = (
        select(IntakeSubmission)
        .where(
            IntakeSubmission.status == IntakeStatus.new,
        )
        # Старые анкеты первыми: очередь должна разбираться по-честному, а не
        # с конца, иначе самые давние заявки остаются невидимыми дольше всех.
        .order_by(IntakeSubmission.created_at)
        # Блокировка строк, а не `asyncio.Lock`: автоматический проход живёт в
        # процессе worker, а кнопки «Синхронизировать» и «Создать из анкет» —
        # в процессах uvicorn (их ещё и несколько). Лок в памяти между ними не
        # работает вовсе, и два одновременных прохода прочитали бы одни и те же
        # анкеты и создали бы по студенту каждый — дубли молча, без ошибки.
        # SKIP LOCKED, а не ожидание: занятые кем-то строки просто достаются
        # следующему проходу, и кнопка не висит, пока синк разбирает очередь.
        .with_for_update(skip_locked=True)
        .limit(limit)
    )
    if not automatic:
        query = query.where(IntakeSubmission.suggested_student_id.is_(None))
    result = await db.execute(query)
    submissions = result.scalars().all()
    primary_batch_count = len(submissions)
    selected_ids = {row.id for row in submissions}
    partner_ids = {
        pair_map[row.id] for row in submissions
        if row.id in pair_map and pair_map[row.id] not in selected_ids
    }
    if partner_ids:
        partner_result = await db.execute(
            select(IntakeSubmission)
            .where(
                IntakeSubmission.id.in_(partner_ids),
                IntakeSubmission.status == IntakeStatus.new,
            )
            .with_for_update(skip_locked=True)
        )
        submissions.extend(partner_result.scalars().all())
    students_index = await load_students_index(db)
    pending_index = [
        {"id": row.id, "full_name": row.full_name or "", "phone": row.phone_normalized or ""}
        for row in candidate_universe
    ]
    selected_by_id = {row.id: row for row in submissions}
    processed_ids: set[uuid.UUID] = set()

    created = linked = skipped = waiting = 0
    stopped_at_cap = False
    for submission in submissions:
        if created + linked >= limit:
            stopped_at_cap = True
            break
        if submission.id in processed_ids:
            continue
        matches = plausible_student_candidates(
            submission.full_name, submission.phone_normalized, students_index
        )
        submission.match_candidate_ids = [str(v) for v in matches.student_ids]
        submission.suggested_student_id = matches.student_ids[0] if len(matches.student_ids) == 1 else None
        submission.suggested_confidence = round(matches.confidence, 3) if matches.student_ids else None
        if matches.student_ids and automatic:
            if (
                settings.ENABLE_INTAKE_AUTO_LINK
                and not submission.identity_review_required
                and _valid_auto_create_name(submission.full_name)
                and is_strong_unique_name_match(matches)
            ):
                candidate = await db.get(Student, matches.student_ids[0])
                if candidate is not None and not candidate.is_archived:
                    await link_submission_to_student(db, submission, candidate, actor_id=None)
                    linked += 1
                    continue

        peer_id = pair_map.get(submission.id)
        peer = selected_by_id.get(peer_id) if peer_id else None
        if peer_id and peer is None and not matches.student_ids:
            # The peer was outside the primary batch or is locked by another
            # worker. Retry after that worker commits; do not mark an otherwise
            # clear cross-form pair as permanently ambiguous.
            waiting += 1
            continue
        if peer is not None:
            processed_ids.update((submission.id, peer.id))
            peer_matches = plausible_student_candidates(
                peer.full_name, peer.phone_normalized, students_index
            )
            if matches.student_ids or peer_matches.student_ids:
                # Let each row follow its own safe CRM candidate path on the
                # next pass (or in this pass if it has not been consumed).
                processed_ids.discard(peer.id)
                processed_ids.discard(submission.id)
            elif automatic and not settings.ENABLE_INTAKE_AUTO_CREATE:
                waiting += 2
                continue
            elif submission.identity_review_required or peer.identity_review_required:
                skipped += 2
                continue
            elif not _valid_auto_create_name(submission.full_name) or not _valid_auto_create_name(peer.full_name):
                submission.identity_review_required = peer.identity_review_required = True
                skipped += 2
                continue
            elif not automatic or (
                automatic_creation_ready(submission, notion_completed_at, sheets_completed_at)
                and automatic_creation_ready(peer, notion_completed_at, sheets_completed_at)
            ):
                primary = submission if submission.source == IntakeSource.package else peer
                secondary = peer if primary is submission else submission
                student = await create_student_from_intake(db, primary, actor_id=actor_id)
                await link_submission_to_student(db, secondary, student, actor_id=actor_id)
                students_index.append({
                    "id": student.id, "full_name": student.full_name,
                    "phone": student.phone, "intake_year": student.intake_year,
                    "user_id": student.user_id,
                })
                created += 1
                linked += 1
                continue
            else:
                waiting += 2
                continue

        pending_candidates = [row for row in pending_index if row["id"] != submission.id]
        intake_matches = (
            plausible_student_candidates(
                submission.full_name, submission.phone_normalized, pending_candidates
            ) if pending_candidates else None
        )
        if matches.student_ids or (intake_matches and intake_matches.student_ids):
            submission.identity_review_required = submission.identity_review_required or len(
                matches.student_ids
            ) > 1 or bool(intake_matches and intake_matches.student_ids)
            skipped += 1
            continue

        if not _valid_auto_create_name(submission.full_name):
            submission.identity_review_required = True
            skipped += 1
            continue

        if automatic:
            from app.core.config import settings
            if not settings.ENABLE_INTAKE_AUTO_CREATE:
                waiting += 1
                continue
            now = datetime.now(timezone.utc)
            notion_at = notion_completed_at
            if notion_at is not None and notion_at.tzinfo is None:
                notion_at = notion_at.replace(tzinfo=timezone.utc)
            sheets_at = sheets_completed_at
            if sheets_at is not None and sheets_at.tzinfo is None:
                sheets_at = sheets_at.replace(tzinfo=timezone.utc)
            if not automatic_creation_ready(
                submission, notion_at, sheets_at, now=now
            ):
                waiting += 1
                continue
            if submission.identity_review_required:
                submission.identity_review_required = True
                skipped += 1
                continue

        student = await create_student_from_intake(db, submission, actor_id)
        # вторая анкета того же человека в этом прогоне не должна создать дубль
        students_index.append({
            "id": student.id, "full_name": student.full_name,
            "phone": student.phone, "intake_year": student.intake_year,
            "user_id": student.user_id,
        })
        pending_index = [row for row in pending_index if row["id"] != submission.id]
        created += 1

    # `has_more` — признак, что проход упёрся в потолок и очередь не пуста.
    # Без него и кнопка, и статус синка врали бы «всё разобрано».
    return {
        "created": created, "linked": linked, "skipped": skipped, "waiting": waiting,
        "has_more": stopped_at_cap or primary_batch_count >= limit,
    }


def _valid_auto_create_name(value: str | None) -> bool:
    name = " ".join(str(value or "").split())
    if len(name) < 3 or name.casefold() in {"без имени", "unknown", "test", "тест"}:
        return False
    return any(char.isalpha() for char in name)


def automatic_creation_ready(
    submission: IntakeSubmission,
    notion_completed_at: datetime | None,
    sheets_completed_at: datetime | None,
    *,
    now: datetime | None = None,
) -> bool:
    """True only after 24h plus successful source reads newer than first_seen."""
    first_seen = submission.first_seen_at or submission.created_at
    if first_seen is None or notion_completed_at is None or sheets_completed_at is None:
        return False
    content_changed_at = submission.content_changed_at or first_seen
    readiness_from = max(first_seen, content_changed_at)
    now = now or datetime.now(timezone.utc)
    if readiness_from.tzinfo is None:
        readiness_from = readiness_from.replace(tzinfo=timezone.utc)
    if notion_completed_at.tzinfo is None:
        notion_completed_at = notion_completed_at.replace(tzinfo=timezone.utc)
    if sheets_completed_at.tzinfo is None:
        sheets_completed_at = sheets_completed_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (
        now - readiness_from >= AUTO_CREATE_WAIT
        and notion_completed_at > readiness_from
        and sheets_completed_at >= readiness_from
    )
