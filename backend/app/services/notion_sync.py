"""Синк Notion-базы «Весь пайплайн клиентов» в notion_snapshots (read-only зеркало).

В карточки студентов ничего не пишется автоматически. Каждая строка Notion
целиком обновляет свой снапшот; привязка к студенту:
- точный матч по телефону или ФИО (confidence 1.0) — привязывается сразу;
- нечёткий матч — только предложение, решение за менеджером;
- нет матча — остаётся в «Notion без привязки».
"""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timezone, date as date_cls
from decimal import Decimal, InvalidOperation

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
    "signed_date", "client_fee", "english_sum", "english_paid",
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
        (t for t in str(v or "").replace(".", " ").split() if t.isdigit() and 2020 <= int(t) <= 2035),
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
    n_status = parse_pipeline_status(d.get("payment_status_raw") or "") if d.get("payment_status_raw") else None
    c_status = contract.pipeline_status.value if contract and contract.pipeline_status else None

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
        "client_remaining": (_money_canon(d.get("client_remaining")), _money_canon(crm("client_remaining_amount", contract))),
        "client_remaining_date": (_date_canon(d.get("client_remaining_date")), _date_canon(crm("client_remaining_date", contract))),
    }


def field_direction(base: str | None, canon_notion: str | None, canon_crm: str | None) -> str:
    """Куда синхронизировать поле относительно эталона base:
    resolved — стороны совпадают; unknown — эталона ещё нет; notion_newer/crm_newer —
    изменилась одна сторона; conflict — обе стороны разошлись с эталоном по-разному."""
    if canon_notion == canon_crm:
        return "resolved"
    if base is None:
        return "unknown"
    notion_changed = canon_notion != base
    crm_changed = canon_crm != base
    if notion_changed and not crm_changed:
        return "notion_newer"
    if crm_changed and not notion_changed:
        return "crm_newer"
    return "conflict"


def reconcile_baseline(snapshot: NotionSnapshot, student, contract) -> None:
    """Обновить эталон снапшота: где Notion и CRM совпали — зафиксировать как
    согласованное значение. Расхождения не трогаем (по ним карточка покажет
    направление). CRM при этом не пишется — только snapshot.synced_baseline."""
    canon = editable_canon(snapshot.normalized_data or {}, student, contract)
    baseline = dict(snapshot.synced_baseline or {})
    changed = False
    for field, (cn, cc) in canon.items():
        if cn == cc and cn is not None and baseline.get(field) != cn:
            baseline[field] = cn
            changed = True
    if changed:
        snapshot.synced_baseline = baseline


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
        .order_by(Contract.student_id, Contract.created_at.desc())
    )).scalars().all():
        contracts.setdefault(c.student_id, c)

    for snapshot in snapshots:
        student = students.get(snapshot.student_id)
        if student is None:
            continue
        reconcile_baseline(snapshot, student, contracts.get(snapshot.student_id))


async def run_sync(db: AsyncSession) -> dict:
    """Полный проход: чтение Notion → upsert снапшотов → матчинг непривязанных."""
    if not is_configured():
        raise RuntimeError("Notion не настроен — задай NOTION_API_KEY и NOTION_DATABASE_ID в .env")

    async with _sync_lock:
        from migration.sources.notion import fetch_all_pages, transform_notion_records
        from migration.transformers.normalize import normalize_phone
        from migration.transformers.match import fuzzy_match

        loop = asyncio.get_event_loop()

        def _fetch() -> list[dict]:
            """Блокирующий requests — уводим в thread pool."""
            pages = fetch_all_pages(settings.NOTION_API_KEY, settings.NOTION_DATABASE_ID)
            return transform_notion_records(pages)

        try:
            rows = await loop.run_in_executor(None, _fetch)

            existing_result = await db.execute(select(NotionSnapshot))
            existing = {s.notion_page_id: s for s in existing_result.scalars().all()}
            students_index = await _load_students_index(db)

            now = datetime.now(timezone.utc)
            created = updated = unchanged = auto_linked = 0
            # Привязанные снапшоты — для прохода по эталону после основного цикла.
            linked_for_baseline: list[NotionSnapshot] = []

            def apply_match(snapshot: NotionSnapshot, row: dict) -> bool:
                """Матчинг непривязанного снапшота. True, если автопривязали."""
                match = fuzzy_match(row.get("full_name", ""), row.get("phone", ""), students_index)
                # После ручной отвязки автопривязка запрещена — только предложение
                if match.student_id and match.confidence >= 1.0 and not snapshot.manual_unlink:
                    snapshot.student_id = match.student_id
                    snapshot.status = NotionMatchStatus.linked
                    snapshot.linked_at = now
                    snapshot.suggested_student_id = match.student_id
                    snapshot.suggested_confidence = 1.0
                    return True
                snapshot.suggested_student_id = match.student_id
                snapshot.suggested_confidence = round(match.confidence, 3) if match.student_id else None
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

            needs_review = await unmatched_count(db)
            counters = {
                "total": len(rows),
                "created": created,
                "updated": updated,
                "unchanged": unchanged,
                "auto_linked": auto_linked,
                "needs_review": needs_review,
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

    interval = max(300, settings.NOTION_SYNC_INTERVAL_SECONDS)
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
