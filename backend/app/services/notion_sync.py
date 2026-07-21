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

# migration/ монтируется в контейнер как /app/migration — переиспользуем читалку
sys.path.insert(0, "/app") if "/app" not in sys.path else None

logger = logging.getLogger(__name__)

_sync_lock = asyncio.Lock()

# Последний запуск (в памяти процесса) — для GET /notion/status
last_run: dict = {
    "at": None,       # ISO datetime
    "ok": None,       # bool
    "error": None,    # str | None
    "counters": None, # {"total": n, "created": n, "updated": n, "auto_linked": n, "needs_review": n}
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


async def _sync_remaining_to_contract(db: AsyncSession, student_id, row: dict) -> None:
    """Единственные два поля, которые авто-переносим из Notion в CRM без ручного
    подтверждения: «Остаток клиента» и дата остатка. Они нужны всегда актуальными
    для уведомлений о платежах и календаря на странице «Финансы». Остальные поля
    Notion остаются read-only — перенос только вручную кнопкой «Принять из Notion»
    (см. /notion/students/{id}/apply-field).
    """
    raw_amount = row.get("client_remaining")
    raw_date = row.get("client_remaining_date")
    if raw_amount is None and raw_date is None:
        return

    result = await db.execute(
        select(Contract).where(Contract.student_id == student_id).order_by(Contract.created_at.desc()).limit(1)
    )
    contract = result.scalars().first()
    if not contract:
        return

    if raw_amount is not None:
        try:
            new_amount = Decimal(str(raw_amount))
        except (InvalidOperation, ValueError):
            new_amount = None
        if new_amount is not None and contract.client_remaining_amount != new_amount:
            contract.client_remaining_amount = new_amount

    if raw_date:
        try:
            new_date = date_cls.fromisoformat(str(raw_date)[:10])
        except ValueError:
            new_date = None
        if new_date is not None and contract.client_remaining_date != new_date:
            contract.client_remaining_date = new_date


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
                        await _sync_remaining_to_contract(db, snapshot.student_id, row)
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
                    await _sync_remaining_to_contract(db, snapshot.student_id, row)

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
            last_run.update(at=now.isoformat(), ok=True, error=None, counters=counters)
            logger.info(f"Notion sync done: {counters}")
            return counters
        except Exception as e:
            last_run.update(
                at=datetime.now(timezone.utc).isoformat(), ok=False, error=str(e), counters=None
            )
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
