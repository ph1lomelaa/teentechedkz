"""Notion mirror and field-level CRM ↔ Notion synchronization.

Notion supplies initial values for uniquely linked students. Later one-sided
edits propagate through the verified outbox; two-sided changes need review.
Ambiguous links and identity matches never choose a target automatically.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from datetime import datetime, timezone, date as date_cls
from decimal import Decimal, InvalidOperation

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models import NotionSnapshot, NotionMatchStatus, Student, Contract
from app.services import background_jobs

# migration/ монтируется в контейнер как /app/migration — переиспользуем читалку
sys.path.insert(0, "/app") if "/app" not in sys.path else None

logger = logging.getLogger(__name__)

_sync_lock = asyncio.Lock()

_STATUS_KIND = "notion_sync_status"


async def last_run() -> dict:
    """Последний запуск (персистится в background_jobs) — для GET /notion/status."""
    job = await background_jobs.get_status(_STATUS_KIND)
    if not job:
        return {"at": None, "ok": None, "error": None, "counters": None}
    return {
        "at": job.finished_at.isoformat() if job.finished_at else None,
        "ok": job.status == "done",
        "error": job.error,
        "counters": (job.result or {}).get("counters"),
    }


def is_configured() -> bool:
    return bool(settings.NOTION_API_KEY.strip() and settings.NOTION_DATABASE_ID.strip())


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


async def _load_students_index(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Student.id, Student.full_name, Student.phone, Student.intake_year).where(
            Student.is_archived == False  # noqa: E712
        )
    )
    return [
        {"id": r.id, "full_name": r.full_name or "", "phone": r.phone or "", "intake_year": r.intake_year}
        for r in result.all()
    ]


# --- Двусторонняя синхронизация «кто последний правил» ---------------------------
# Синк НИЧЕГО не пишет в CRM автоматически. Он лишь ведёт «эталон» (synced_baseline)
# — последнее значение, на котором Notion и CRM сошлись, — чтобы карточка могла
# показать, какая сторона изменилась последней. Перенос значений всегда вручную:
# «Принять из Notion» (apply_field) или «→ Записать в Notion» (push_field).

# Поля, которые можно править и синхронизировать в обе стороны. Ключ — внутреннее имя
# поля (как в сверке и в whitelist apply/push), значения канонизируются одинаково для
# обеих сторон, чтобы сравнение было честным.
EDITABLE_FIELDS = (
    "full_name", "phone", "degree_level", "intake_year", "pipeline_status",
    "signed_date", "client_fee", "english_sum", "english_paid", "mentor_total",
    "client_remaining", "client_remaining_date",
)


def _name_canon(v) -> str | None:
    return " ".join(str(v).lower().split()) or None if v else None


def _money_canon(v) -> str | None:
    if v in (None, ""):
        return None
    try:
        return f"{Decimal(str(v).replace(' ', '').replace(',', '.')):.2f}"
    except (InvalidOperation, ValueError):
        return None


def _date_canon(v) -> str | None:
    if not v:
        return None
    try:
        return date_cls.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        return None


def _intake_canon(v) -> str | None:
    year = next(
        (t for t in str(v or "").replace(".", " ").split() if t.isdigit() and 1900 <= int(t) <= 2200),
        None,
    )
    return year


def editable_canon(d: dict, student, contract) -> dict[str, tuple[str | None, str | None]]:
    """{field: (канон Notion, канон CRM)} для всех редактируемых полей. Обе стороны
    приводятся к одному виду, поэтому равенство канонов == «значения совпадают».
    d — normalized_data снапшота; student/contract — из CRM (contract может быть None."""
    from migration.transformers.normalize import (
        normalize_phone, parse_degree_or_none, parse_pipeline_status,
    )

    def crm(attr, obj):
        return getattr(obj, attr, None) if obj is not None else None

    n_degree = parse_degree_or_none(d.get("degree_raw") or "")
    c_degree = student.degree_level.value if student and student.degree_level else None
    try:
        n_status = parse_pipeline_status(d.get("payment_status_raw") or "") if d.get("payment_status_raw") else "no_status"
    except ValueError:
        # Preserve the raw snapshot so the new option appears in the review
        # report. The pipeline apply step rejects it before changing CRM.
        n_status = None
    c_status = contract.pipeline_status.value if contract and contract.pipeline_status else "no_status"

    return {
        "full_name": (_name_canon(d.get("full_name")), _name_canon(crm("full_name", student))),
        "phone": (normalize_phone(d.get("phone") or "") or None, normalize_phone(crm("phone", student) or "") or None),
        "degree_level": (n_degree, c_degree),
        "intake_year": (_intake_canon(d.get("intake_raw")), str(student.intake_year) if student and student.intake_year else None),
        "pipeline_status": (n_status, c_status),
        "signed_date": (_date_canon(d.get("date_of_agreement")), _date_canon(crm("signed_date", contract))),
        "client_fee": (_money_canon(d.get("client_fee")), _money_canon(crm("amount", contract))),
        "english_sum": (_money_canon(d.get("english_sum")), _money_canon(crm("english_sum", contract))),
        "english_paid": (_money_canon(d.get("english_paid")), _money_canon(crm("english_paid", contract))),
        "mentor_total": (_money_canon(d.get("mentor_total")), _money_canon(crm("mentor_total_owed", contract))),
        "client_remaining": (_money_canon(d.get("client_remaining")), _money_canon(crm("client_remaining_amount", contract))),
        "client_remaining_date": (_date_canon(d.get("client_remaining_date")), _date_canon(crm("client_remaining_date", contract))),
    }


def field_direction(
    base: str | None,
    canon_notion: str | None,
    canon_crm: str | None,
    *,
    has_baseline: bool | None = None,
) -> str:
    """Куда синхронизировать поле относительно эталона base:
    resolved — стороны совпадают; unknown — эталона ещё нет; notion_newer/crm_newer —
    изменилась одна сторона; conflict — обе стороны разошлись с эталоном по-разному
    или одна из сторон стёрла значение без подтверждённого события очистки.

    По умолчанию совместимость со старыми вызовами: `None` означает отсутствие
    baseline. API передаёт наличие ключа отдельно, чтобы отличать сохранённый
    пустой baseline от отсутствующего эталона.
    """
    from app.services.notion_field_sync_policy import FieldDecision, reconcile_field

    if has_baseline is None:
        has_baseline = base is not None
    result = reconcile_field(
        baseline=base,
        has_baseline=has_baseline,
        crm_value=canon_crm,
        notion_value=canon_notion,
    )
    return {
        FieldDecision.RESOLVED: "resolved",
        FieldDecision.CRM_CHANGED: "crm_newer",
        FieldDecision.NOTION_CHANGED: "notion_newer",
        FieldDecision.CONFLICT: "conflict",
        FieldDecision.UNKNOWN_BASELINE: "unknown",
        FieldDecision.UNSAFE_CLEAR: "conflict",
    }[result.decision]


def reconcile_baseline(snapshot: NotionSnapshot, student, contract) -> None:
    """Обновить эталон снапшота: где Notion и CRM совпали — зафиксировать как
    согласованное значение. Расхождения не трогаем (по ним карточка покажет
    направление). CRM при этом не пишется — только snapshot.synced_baseline."""
    canon = editable_canon(snapshot.normalized_data or {}, student, contract)
    baseline = dict(snapshot.synced_baseline or {})
    changed = False
    if canon.get("pipeline_status", (None, None))[0] == canon.get("pipeline_status", (None, None))[1] and "_portal_status" in baseline:
        baseline.pop("_portal_status")
        changed = True
    for field, (cn, cc) in canon.items():
        if cn == cc and cn is not None and baseline.get(field) != cn:
            baseline[field] = cn
            changed = True
        if cn == cc and cn is not None and settings.ENABLE_NOTION_FIELD_SYNC:
            initialized = set(baseline.get("_initialized_fields", []))
            if field not in initialized and field in AUTO_RECONCILE_FIELDS:
                baseline["_initialized_fields"] = sorted(initialized | {field})
                changed = True
    if changed:
        snapshot.synced_baseline = baseline


AUTO_RECONCILE_FIELDS = frozenset({"full_name", "phone", "degree_level", "intake_year", "pipeline_status"})


async def _enqueue_field_reconciliation(
    db: AsyncSession,
    snapshot: NotionSnapshot,
    student: Student,
    contract: Contract | None,
    canon: dict[str, tuple[str | None, str | None]],
    manual_fields: set[str] | None = None,
) -> None:
    """Persist only reviewed profile-field decisions for the gated worker.

    The mirror pull never writes directly to business records. Profile and
    work-status writes are classified into the feature-gated verified outbox.
    Financial fields are outside this registry.
    """
    if not settings.ENABLE_NOTION_FIELD_SYNC:
        return

    from app.services.notion_field_sync_outbox import enqueue_reconciliation
    from app.services.notion_field_sync_policy import FieldDecision, FieldSide, ReconciliationResult, reconcile_profile_field

    baseline = snapshot.synced_baseline or {}
    for field in AUTO_RECONCILE_FIELDS:
        pair = canon.get(field)
        if pair is None:
            continue
        notion_value, crm_value = pair
        has_baseline = field in baseline
        baseline_value = baseline.get(field)
        result = reconcile_profile_field(field_key=field,
            baseline=baseline_value,
            has_baseline=has_baseline,
            notion_value=notion_value,
            crm_value=crm_value,
        )
        # For an initial linked record Notion is the primary source. Once
        # a common baseline exists, either side may propagate a one-sided edit.
        if field not in baseline.get("_initialized_fields", []) and notion_value is not None and not (field == "pipeline_status" and notion_value == "no_status") and crm_value != notion_value:
            if field not in (manual_fields or set()):
                result = ReconciliationResult(FieldDecision.NOTION_CHANGED, crm_value, notion_value, FieldSide.NOTION)
            # An audited manual edit keeps the ordinary baseline decision:
            # safe one-sided edits propagate, unknown/two-sided edits stay
            # reviewable. Bootstrap must not erase employees' portal edits.
        if result.decision.value == "resolved":
            continue
        # Dedupe by this field's value state; an unrelated page-property edit
        # must not create a second copy of the same unresolved decision.
        state = repr((field, notion_value, crm_value, has_baseline, baseline_value))
        import hashlib

        source_revision = hashlib.sha256(state.encode("utf-8")).hexdigest()
        await enqueue_reconciliation(
            db,
            notion_snapshot_id=snapshot.id,
            student_id=student.id,
            notion_page_id=snapshot.notion_page_id,
            field_key=field,
            source_revision=source_revision,
            result=result,
            baseline_value=baseline_value,
            has_baseline=has_baseline,
            expected_notion_last_edited_at=snapshot.notion_last_edited_at,
            reason="Notion — основной источник при первом согласовании; последующие правки синхронизируются в обе стороны, конфликт требует выбора.",
        )


async def _reconcile_baselines(db: AsyncSession, snapshots: list[NotionSnapshot]) -> None:
    """Массовая фиксация эталона по привязанным снапшотам: грузим студентов и их
    последние договоры одним заходом, затем сверяем каждый снапшот с CRM."""
    student_ids = {s.student_id for s in snapshots if s.student_id}
    if not student_ids:
        return

    students = {
        s.id: s
        for s in (await db.execute(select(Student).where(Student.id.in_(student_ids)))).scalars().all()
    }
    # Последний договор по каждому студенту (первый по created_at DESC).
    contracts: dict = {}
    for c in (await db.execute(
        select(Contract)
        .where(Contract.student_id.in_(student_ids))
        .order_by(Contract.student_id, Contract.created_at.desc(), Contract.id.desc())
    )).scalars().all():
        contracts.setdefault(c.student_id, c)

    duplicate_links = set((await db.execute(
        select(NotionSnapshot.student_id).where(
            NotionSnapshot.student_id.in_(student_ids), NotionSnapshot.status == NotionMatchStatus.linked
        ).group_by(NotionSnapshot.student_id).having(func.count() > 1)
    )).scalars().all())
    from app.models.status_history import StatusHistory
    from app.services.notion_field_sync_runtime import canonical_profile_value
    manual_values = {}
    entity_ids = student_ids | {contract.id for contract in contracts.values()}
    audit_rows = (await db.execute(select(StatusHistory).where(
        StatusHistory.entity_id.in_(entity_ids), StatusHistory.source == "manual",
        StatusHistory.field_changed.in_(AUTO_RECONCILE_FIELDS)
    ).order_by(StatusHistory.changed_at.desc(), StatusHistory.id.desc()))).scalars().all()
    for audit in audit_rows:
        try:
            uuid.UUID(audit.changed_by)
        except (ValueError, TypeError, AttributeError):
            continue
        manual_values.setdefault((audit.entity_type, audit.entity_id, audit.field_changed), audit.new_value)
    for snapshot in snapshots:
        if snapshot.student_id in duplicate_links:
            continue  # No automatic choice between several Notion pages.
        student = students.get(snapshot.student_id)
        if student is None or student.is_archived:
            continue
        contract = contracts.get(snapshot.student_id)
        canon = editable_canon(snapshot.normalized_data or {}, student, contract)
        manual_fields = set()
        for field, (_, crm_value) in canon.items():
            entity_type, entity_id = ("contract", contract.id) if field == "pipeline_status" and contract else ("student", student.id)
            key = (entity_type, entity_id, field)
            if key in manual_values and canonical_profile_value(field, manual_values[key]) == crm_value:
                manual_fields.add(field)
        await _enqueue_field_reconciliation(db, snapshot, student, contract, canon, manual_fields=manual_fields)
        reconcile_baseline(snapshot, student, contract)


def _normalize_id(value: str | None) -> str:
    return (value or "").replace("-", "").lower()


def _page_left_source(page_id: str) -> bool:
    """Ушла ли страница из нашей базы Notion на самом деле.

    True — Notion подтвердил: страница удалена, в корзине, недоступна (404) или
    перенесена в другую базу. False — страница на месте (значит, выдача пришла
    обрезанной) или спросить не удалось; в обоих случаях синк надо остановить,
    а не терять записи.
    """
    from app.services import notion_write

    try:
        resp = notion_write._request("GET", f"{notion_write._API}/pages/{page_id}")
    except Exception:
        logger.warning("Notion: не удалось проверить пропавшую страницу %s", page_id, exc_info=True)
        return False
    if resp.status_code == 404:
        return True
    if resp.status_code != 200:
        return False
    page = resp.json()
    if page.get("archived") or page.get("in_trash"):
        return True
    parent = page.get("parent") or {}
    source = _normalize_id(settings.NOTION_DATABASE_ID)
    parent_ids = {_normalize_id(parent.get("data_source_id")), _normalize_id(parent.get("database_id"))}
    return source not in parent_ids


async def run_sync(db: AsyncSession) -> dict:
    """Полный проход: чтение Notion → upsert снапшотов → матчинг непривязанных."""
    if not is_configured():
        raise RuntimeError("Notion не настроен — задай NOTION_API_KEY и NOTION_DATABASE_ID в .env")

    async with _sync_lock:
        from migration.sources.notion import fetch_all_pages, transform_notion_records
        from migration.transformers.normalize import normalize_phone
        from app.services.intake_identity import (
            is_strong_unique_name_match,
            plausible_student_candidates,
        )

        loop = asyncio.get_event_loop()

        def _fetch() -> list[dict]:
            """Блокирующий requests — уводим в thread pool."""
            pages = fetch_all_pages(settings.NOTION_API_KEY, settings.NOTION_DATABASE_ID)
            return transform_notion_records(pages)

        try:
            rows = await loop.run_in_executor(None, _fetch)

            existing_result = await db.execute(select(NotionSnapshot))
            existing = {s.notion_page_id: s for s in existing_result.scalars().all()}
            # Deleted or missing pages need review before the source can be
            # treated as complete; a percentage threshold could miss a few
            # silently truncated rows.
            incoming_ids = {row["notion_page_id"] for row in rows}
            missing_ids = set(existing) - incoming_ids
            removed = 0
            if missing_ids:
                # Каждую пропавшую страницу спрашиваем у Notion напрямую.
                # Удалённые/перенесённые убираем из зеркала (на Обзоре их больше
                # нет — как и в Notion). Карточка ученика, его назначения и
                # кабинет при этом не трогаются: у снапшота нет зависимых
                # таблиц, а студент — отдельная запись CRM.
                gone = await loop.run_in_executor(
                    None, lambda: {pid for pid in missing_ids if _page_left_source(pid)}
                )
                still_there = missing_ids - gone
                if still_there:
                    raise RuntimeError(
                        f"Notion не вернул {len(still_there)} страниц, которые в Notion на месте — "
                        f"выдача неполная, синк остановлен ({len(rows)} строк сейчас, {len(existing)} ранее)"
                    )
                for page_id in gone:
                    snapshot = existing.pop(page_id)
                    logger.info("Notion: страница удалена или перенесена — убираем из зеркала: %s (%s)",
                                snapshot.full_name, page_id)
                    await db.delete(snapshot)
                removed = len(gone)
            students_index = await _load_students_index(db)
            linked_student_ids = {
                student_id for student_id in (await db.execute(
                    select(NotionSnapshot.student_id).where(
                        NotionSnapshot.status == NotionMatchStatus.linked,
                        NotionSnapshot.student_id.isnot(None),
                    )
                )).scalars().all()
            }

            now = datetime.now(timezone.utc)
            created = updated = unchanged = auto_linked = 0
            # Привязанные снапшоты — для прохода по эталону после основного цикла.
            linked_for_baseline: list[NotionSnapshot] = []

            def apply_match(snapshot: NotionSnapshot, row: dict) -> bool:
                """Матчинг непривязанного снапшота. True, если автопривязали."""
                if not row.get("full_name"):
                    snapshot.suggested_student_id = None
                    snapshot.suggested_confidence = None
                    return False
                match = plausible_student_candidates(
                    row.get("full_name", ""), row.get("phone", ""), students_index
                )
                # После ручной отвязки автопривязка запрещена — только предложение
                # Предложение собирает ВСЕх возможных кандидатов. Для автопривязки
                # требуется один кандидат с точным/транслитерированным именем или
                # совпавшим телефоном; похожее написание само по себе не достаточно.
                if (
                    len(match.student_ids) == 1
                    and match.confidence >= 0.95
                    and is_strong_unique_name_match(match)
                    and not snapshot.manual_unlink
                    and match.student_ids[0] not in linked_student_ids
                ):
                    student_id = match.student_ids[0]
                    snapshot.student_id = student_id
                    snapshot.status = NotionMatchStatus.linked
                    snapshot.linked_at = now
                    snapshot.suggested_student_id = student_id
                    snapshot.suggested_confidence = round(match.confidence, 3)
                    linked_student_ids.add(student_id)
                    return True
                snapshot.suggested_student_id = match.student_ids[0] if len(match.student_ids) == 1 else None
                snapshot.suggested_confidence = round(match.confidence, 3) if match.student_ids else None
                return False

            for row in rows:
                raw_properties = row.pop("raw_properties")
                snapshot = existing.get(row["notion_page_id"])
                incoming_edited = _parse_iso(row.get("last_edited_time"))

                # Строка в Notion не менялась — не переписываем JSONB зря
                # (иначе каждый цикл — UPDATE всей таблицы и WAL-мусор).
                # Матчинг для непривязанных всё равно освежаем: база студентов растёт.
                if (
                    snapshot is not None
                    and incoming_edited is not None
                    and snapshot.notion_last_edited_at == incoming_edited
                ):
                    unchanged += 1
                    if snapshot.status == NotionMatchStatus.new and apply_match(snapshot, row):
                        auto_linked += 1
                    if snapshot.status == NotionMatchStatus.linked and snapshot.student_id:
                        linked_for_baseline.append(snapshot)
                    continue

                if snapshot is None:
                    snapshot = NotionSnapshot(
                        notion_page_id=row["notion_page_id"],
                        raw_properties={},
                        normalized_data={},
                        status=NotionMatchStatus.new,
                        first_seen_at=now,
                    )
                    db.add(snapshot)
                    created += 1
                else:
                    updated += 1

                snapshot.notion_url = row.get("notion_url")
                snapshot.full_name = (row.get("full_name") or "")[:500] or None
                snapshot.phone_normalized = normalize_phone(row.get("phone", "")) or None
                snapshot.raw_properties = raw_properties
                snapshot.normalized_data = row
                snapshot.notion_last_edited_at = incoming_edited
                snapshot.synced_at = now

                if snapshot.status == NotionMatchStatus.new and apply_match(snapshot, row):
                    auto_linked += 1
                if snapshot.status == NotionMatchStatus.linked and snapshot.student_id:
                    linked_for_baseline.append(snapshot)

            await _reconcile_baselines(db, linked_for_baseline)

            await db.commit()

            field_sync_counters = {
                "claimed": 0, "dry_run": 0, "applied": 0,
                "conflict": 0, "superseded": 0, "retry": 0,
            }
            if settings.ENABLE_NOTION_FIELD_SYNC:
                from app.services.notion_field_sync_runtime import process_outbox_batch

                field_sync_counters = await process_outbox_batch(
                    db,
                    limit=20,
                    dry_run=settings.NOTION_FIELD_SYNC_DRY_RUN,
                )

            # Creating/deleting students, assignments and accounts remains
            # separate from verified synchronization of mapped fields.

            needs_review = await unmatched_count(db)
            counters = {
                "total": len(rows),
                "created": created,
                "updated": updated,
                "unchanged": unchanged,
                "auto_linked": auto_linked,
                "needs_review": needs_review,
                "removed": removed,
                "field_sync": field_sync_counters,
            }
            await background_jobs.upsert_status(_STATUS_KIND, ok=True, error=None, counters=counters)
            logger.info(f"Notion sync done: {counters}")
            return counters
        except Exception as e:
            await background_jobs.upsert_status(_STATUS_KIND, ok=False, error=str(e), counters=None)
            raise


async def unmatched_count(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(NotionSnapshot).where(
            NotionSnapshot.status == NotionMatchStatus.new
        )
    )
    return result.scalar() or 0


async def sync_loop() -> None:
    """Фоновый цикл: каждые NOTION_SYNC_INTERVAL_SECONDS. Запускается из lifespan."""
    from app.core.database import AsyncSessionLocal

    interval = max(60, settings.NOTION_SYNC_INTERVAL_SECONDS)
    logger.info(f"Notion sync loop started (every {interval}s)")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await run_sync(db)
        except asyncio.CancelledError:
            logger.info("Notion sync loop cancelled")
            return
        except Exception as e:
            logger.error(f"Notion sync failed: {e}")
        await asyncio.sleep(interval)


async def enqueue_crm_field_edits(db: AsyncSession, student: Student, old_values: dict) -> dict:
    """Record an explicit CRM edit in the same transaction as the edit itself."""
    from app.models.contract import Contract
    from app.services.notion_field_sync_outbox import enqueue_reconciliation
    from app.services.notion_field_sync_policy import FieldDecision, FieldSide, ReconciliationResult, reconcile_profile_field
    from app.services.notion_field_sync_runtime import canonical_profile_value

    if not settings.ENABLE_NOTION_FIELD_SYNC:
        return {"state": "disabled", "queued": 0, "conflicts": 0}
    if student.is_archived:
        return {"state": "archived", "queued": 0, "conflicts": 0}
    fields = set(old_values) & AUTO_RECONCILE_FIELDS
    if not fields:
        return {"state": "unchanged", "queued": 0, "conflicts": 0}
    snapshots = (await db.execute(select(NotionSnapshot).where(
        NotionSnapshot.student_id == student.id, NotionSnapshot.status == NotionMatchStatus.linked
    ).with_for_update())).scalars().all()
    if len(snapshots) != 1:
        return {"state": "not_linked" if not snapshots else "ambiguous_link", "queued": 0, "conflicts": 0}
    snapshot = snapshots[0]
    contract = (await db.execute(select(Contract).where(Contract.student_id == student.id)
        .order_by(Contract.created_at.desc(), Contract.id.desc()).limit(1))).scalar_one_or_none()
    canon = editable_canon(snapshot.normalized_data or {}, student, contract)
    baseline = dict(snapshot.synced_baseline or {})
    queued = conflicts = 0
    for field in sorted(fields):
        notion_value, crm_value = canon[field]
        if canonical_profile_value(field, old_values[field]) == crm_value and crm_value == notion_value:
            continue
        if crm_value == notion_value:
            baseline[field] = crm_value
            continue
        has_baseline = field in baseline
        if has_baseline:
            result = reconcile_profile_field(field_key=field, baseline=baseline[field], has_baseline=True,
                crm_value=crm_value, notion_value=notion_value)
        else:
            # The employee explicitly edited this field. This is a new write
            # intent, not an old unexplained CRM/Notion discrepancy.
            result = ReconciliationResult(FieldDecision.CRM_CHANGED, crm_value, notion_value, FieldSide.CRM)
            # Notion supplied the initial reference. Retain it so a later
            # Notion edit cannot erase this explicit CRM intent on bootstrap.
            baseline[field] = notion_value
            has_baseline = True
        item = await enqueue_reconciliation(db, notion_snapshot_id=snapshot.id,
            student_id=student.id, notion_page_id=snapshot.notion_page_id, field_key=field,
            source_revision=f"crm-edit:{uuid.uuid4()}", result=result,
            baseline_value=baseline.get(field), has_baseline=has_baseline,
            expected_notion_last_edited_at=snapshot.notion_last_edited_at,
            reason="Изменение сотрудником на платформе; перед записью проверяются актуальные значения Notion.")
        if item.direction.value == "conflict":
            conflicts += 1
        else:
            queued += 1
    baseline["_initialized_fields"] = sorted(set(baseline.get("_initialized_fields", [])) | fields)
    snapshot.synced_baseline = baseline
    return {"state": "conflict" if conflicts else "queued" if queued else "synced",
            "queued": queued, "conflicts": conflicts, "dry_run": settings.NOTION_FIELD_SYNC_DRY_RUN}


async def field_sync_loop() -> None:
    """Drain CRM edits independently of the slower Notion catalogue polling."""
    from app.services.notion_field_sync_runtime import process_outbox_batch
    while True:
        try:
            if settings.ENABLE_NOTION_FIELD_SYNC:
                async with AsyncSessionLocal() as db:
                    await process_outbox_batch(db, limit=50, dry_run=settings.NOTION_FIELD_SYNC_DRY_RUN)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Notion field synchronization failed; pending writes will retry")
        await asyncio.sleep(15)
