"""Автосинк ответов Google-форм («Пакет сопровождения», «Кейсы студентов») в intake_submissions.

Строки форм НЕ пишутся в карточки студентов автоматически — только в staging-таблицу.
Привязка к студенту и создание студентов происходят вручную через /sync/submissions.
Суммы договора и договорённости никогда не переносятся автоматически (human-only поля).
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import sys
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import IntakeSubmission, IntakeSource, IntakeStatus, Student
from app.services import background_jobs

# migration/ монтируется в контейнер как /app/migration — переиспользуем клиент и нормализаторы
sys.path.insert(0, "/app") if "/app" not in sys.path else None

logger = logging.getLogger(__name__)

_sync_lock = asyncio.Lock()

_STATUS_KIND = "sheets_sync_status"


async def last_run() -> dict:
    """Последний запуск (персистится в background_jobs) — для GET /sync/status."""
    job = await background_jobs.get_status(_STATUS_KIND)
    if not job:
        return {"at": None, "ok": None, "error": None, "counters": None}
    return {
        "at": job.finished_at.isoformat() if job.finished_at else None,
        "ok": job.status == "done",
        "error": job.error,
        "counters": (job.result or {}).get("counters"),
    }

# --- Маппинг колонок форм → внутренние ключи -------------------------------
# Заголовки матчатся по подстроке (в реальных формах пробелы/регистр гуляют)

PACKAGE_FIELD_PATTERNS: dict[str, str] = {
    "фио студента": "full_name",
    "номер телефона": "phone",
    "год поступления": "intake_year",
    "бакалавриат\\магистратуру": "degree_level",
    "профориентация": "svc_proforientation",
    "мок тест": "svc_ielts_mock",
    "ielts подготовка": "svc_ielts_prep",
    "сат подготовка": "svc_sat_prep",
    "портфолио сколько направлении": "svc_portfolio",
    "стоимость сопровождения": "contract_amount",       # human-only: не переносится
    "страны поступления": "countries",
    "личные договоренности": "agreements",              # human-only: не переносится
    "имя менеджера": "manager_name",
}

CASES_FIELD_PATTERNS: dict[str, str] = {
    "фио студента": "full_name",
    "номер телефона": "phone",
    "возраст": "age",
    "с какого вы города": "city",
    "бакалавриат\\магистратуру": "degree_level",
    "какую специальность": "specialty",
    "бюджет на обучение": "budget",
    "год поступления": "intake_year",
    "ielts\\toefl": "english_level",
    "sat\\gmat\\gre": "sat_level",
    "внешкольные достижения": "achievements",
    "транскрипт и резюме": "transcript_url",
    "имя вашего менеджера": "manager_name",
    "особые договоренности": "agreements",              # human-only: не переносится
    "средний балл оценок": "gpa",
    "страна поступления": "countries",
}


def map_row(headers: list[str], row: list[str], source: IntakeSource) -> dict:
    """Строка листа → {internal_key: value} + все исходные колонки в raw."""
    patterns = PACKAGE_FIELD_PATTERNS if source == IntakeSource.package else CASES_FIELD_PATTERNS
    mapped: dict = {}
    for header, value in zip(headers, row):
        if value is None:
            continue
        value = str(value).strip()
        if not value or value.lower() in ("nan", "none"):
            continue
        h = str(header).strip().lower()
        for pattern, key in patterns.items():
            if pattern in h:
                mapped.setdefault(key, value)
                break
        if h == "timestamp":
            mapped["timestamp"] = value
    return mapped


def row_fingerprint(source: str, timestamp: str, full_name: str) -> str:
    base = f"{source}|{timestamp}|{(full_name or '').strip().lower()}"
    return hashlib.sha256(base.encode()).hexdigest()


def _parse_timestamp(raw: str) -> datetime | None:
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(raw.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
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


async def _ingest_dataframe(db: AsyncSession, df, source: IntakeSource, students_index: list[dict]) -> dict:
    """Записать новые строки листа в intake_submissions. Возвращает счётчики."""
    from migration.transformers.normalize import normalize_phone
    from migration.transformers.match import fuzzy_match

    existing = await db.execute(select(IntakeSubmission.row_fingerprint))
    known = {r[0] for r in existing.all()}

    headers = [str(h) for h in df.columns]
    new_count = 0
    matched_count = 0

    # Позиционный доступ: устойчиво к дублирующимся/пустым заголовкам листа
    for row_values in df.itertuples(index=False, name=None):
        values = list(row_values)
        mapped = map_row(headers, values, source)
        full_name = mapped.get("full_name", "")
        if not full_name:
            continue

        fp = row_fingerprint(source.value, mapped.get("timestamp", ""), full_name)
        if fp in known:
            continue
        known.add(fp)

        phone_norm = normalize_phone(mapped.get("phone", "")) or None
        match = fuzzy_match(full_name, mapped.get("phone", ""), students_index)

        raw_data = {str(h).strip(): (str(v).strip() if v is not None else "") for h, v in zip(headers, values)}

        submission = IntakeSubmission(
            source=source,
            submitted_at=_parse_timestamp(mapped.get("timestamp", "")),
            row_fingerprint=fp,
            raw_data=raw_data,
            full_name=full_name[:500],
            phone_normalized=phone_norm,
            manager_name=(mapped.get("manager_name") or "")[:200] or None,
            suggested_student_id=match.student_id,
            suggested_confidence=round(match.confidence, 3) if match.student_id else None,
            status=IntakeStatus.new,
        )
        db.add(submission)
        new_count += 1
        if match.student_id:
            matched_count += 1

    await db.commit()
    return {"total_rows": len(df), "new": new_count, "matched": matched_count}


def is_configured() -> bool:
    import os
    if settings.GOOGLE_SERVICE_ACCOUNT_JSON.strip():
        return True
    path = settings.GOOGLE_SERVICE_ACCOUNT_FILE.strip()
    return bool(path and os.path.exists(path))


async def run_sync(db: AsyncSession) -> dict:
    """Полный проход: discover → чтение обеих форм → ingest. Вызывается циклом и кнопкой."""
    if not is_configured():
        raise RuntimeError(
            "Ключ сервисного аккаунта не найден — задай GOOGLE_SERVICE_ACCOUNT_JSON "
            "или GOOGLE_SERVICE_ACCOUNT_FILE в .env"
        )

    async with _sync_lock:
        from migration.sources.google_sheets import GoogleSheetsClient

        loop = asyncio.get_event_loop()

        def _fetch() -> dict:
            """Блокирующая работа с Google API — уводим в thread pool."""
            client = GoogleSheetsClient()
            spreadsheets = client.discover()
            dfs = {}
            if "package" in spreadsheets:
                dfs["package"] = client.get_df(spreadsheets["package"], "Form Responses 1")
            if "cases" in spreadsheets:
                dfs["cases"] = client.get_df(spreadsheets["cases"], "Form Responses 1")
            return dfs

        try:
            dfs = await loop.run_in_executor(None, _fetch)

            students_index = await _load_students_index(db)
            counters: dict = {}
            if "package" in dfs:
                counters["package"] = await _ingest_dataframe(db, dfs["package"], IntakeSource.package, students_index)
            if "cases" in dfs:
                counters["cases"] = await _ingest_dataframe(db, dfs["cases"], IntakeSource.cases, students_index)

            if not counters:
                raise RuntimeError(
                    "Таблицы форм не найдены — проверь, что обе таблицы расшарены на email сервисного аккаунта"
                )

            await background_jobs.upsert_status(_STATUS_KIND, ok=True, error=None, counters=counters)
            logger.info(f"Sheets sync done: {counters}")
            return counters
        except Exception as e:
            await background_jobs.upsert_status(_STATUS_KIND, ok=False, error=str(e), counters=None)
            raise


async def new_submissions_count(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count()).select_from(IntakeSubmission).where(IntakeSubmission.status == IntakeStatus.new)
    )
    return result.scalar() or 0


async def sync_loop() -> None:
    """Фоновый цикл: каждые SHEETS_SYNC_INTERVAL_SECONDS. Запускается из lifespan."""
    from app.core.database import AsyncSessionLocal

    interval = max(60, settings.SHEETS_SYNC_INTERVAL_SECONDS)
    logger.info(f"Sheets sync loop started (every {interval}s)")
    while True:
        try:
            async with AsyncSessionLocal() as db:
                await run_sync(db)
        except asyncio.CancelledError:
            logger.info("Sheets sync loop cancelled")
            return
        except Exception as e:
            logger.error(f"Sheets sync failed: {e}")
        await asyncio.sleep(interval)
