"""Read Google Forms into staging; student creation is a separately gated step."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import IntakeSubmission, IntakeSource, IntakeStatus, Student
from app.services import background_jobs
from app.services.intake_identity import source_identity, plausible_student_candidates

# migration/ монтируется в контейнер как /app/migration — переиспользуем клиент и нормализаторы
sys.path.insert(0, "/app") if "/app" not in sys.path else None

logger = logging.getLogger(__name__)

# Только против самоналожения прохода в ЭТОМ процессе (медленный синк ещё
# идёт, а его уже дёрнули кнопкой). Между процессами не работает вовсе —
# worker и uvicorn общей памяти не имеют, и защита от гонки при разборе
# анкет живёт на уровне БД (intake_promote: SELECT ... FOR UPDATE SKIP LOCKED).
_sync_lock = asyncio.Lock()

_STATUS_KIND = "sheets_sync_status"


def _staging_source_key(
    identity_key: str,
    digest: str,
    *,
    duplicate: bool,
    conflicting_duplicate_content: bool,
    existing_keys: set[str],
) -> str:
    """Keep staged identity stable if an export later collapses duplicates.

    Two different payloads sharing one response key are permanently marked for
    review, but use a content suffix rather than source row order so exports
    that reorder rows do not invent new staging records.
    """
    if duplicate:
        suffix = "ambiguous" if conflicting_duplicate_content else "duplicate"
        return f"{identity_key}:{suffix}:{digest}"
    if identity_key in existing_keys:
        return identity_key
    for suffix in ("duplicate", "ambiguous"):
        previous_key = f"{identity_key}:{suffix}:{digest}"
        if previous_key in existing_keys:
            return previous_key
    return identity_key


def _has_historical_identity_conflict(identity_key: str, existing_keys: set[str]) -> bool:
    """Keep a once-colliding source identity in review on later exports too."""
    prefix = f"{identity_key}:ambiguous:"
    return any(key.startswith(prefix) for key in existing_keys)


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

# The public landing form already posts canonical, machine-readable field
# names. Keep accepting those names here as well as the human Google Sheet
# headers above; otherwise a landing lead can be displayed in the inbox but
# loses phone/city/degree/year/country when staff creates the Student record.
CANONICAL_FIELD_KEYS: dict[str, str] = {
    "full_name": "full_name",
    "phone": "phone",
    "city": "city",
    "degree_level": "degree_level",
    "intake_year": "intake_year",
    "target_country": "countries",
    "program_interest": "specialty",
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
        canonical_key = CANONICAL_FIELD_KEYS.get(h)
        if canonical_key:
            mapped.setdefault(canonical_key, value)
            continue
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


async def load_students_index(db: AsyncSession) -> list[dict]:
    """Карточки в форме, которую понимает `fuzzy_match`.

    `user_id` в наборе не нужен матчингу, но нужен всем, кто по его результату
    что-то привязывает: карточка с уже выданным кабинетом — не кандидат.
    `fuzzy_match` лишний ключ игнорирует, поэтому это чистая добавка.
    """
    result = await db.execute(
        select(
            Student.id, Student.full_name, Student.phone, Student.intake_year, Student.user_id, Student.city
        ).where(
            Student.is_archived == False  # noqa: E712
        )
    )
    return [
        {
            "id": r.id,
            "full_name": r.full_name or "",
            "phone": r.phone or "",
            "intake_year": r.intake_year,
            "user_id": r.user_id,
            "city": r.city,
        }
        for r in result.all()
    ]


async def _ingest_dataframe(db: AsyncSession, df, source: IntakeSource, students_index: list[dict]) -> dict:
    """Insert/update source rows, preserving identity and recording each revision."""
    from migration.transformers.normalize import normalize_phone

    existing = await db.execute(select(IntakeSubmission))
    existing_rows = list(existing.scalars().all())
    rows_by_key = {r.source_key: r for r in existing_rows if r.source_key}
    legacy_by_fp = {r.row_fingerprint: r for r in existing_rows}
    legacy_by_time: dict[tuple[str, datetime], list] = defaultdict(list)
    for row in existing_rows:
        if row.submitted_at:
            at = row.submitted_at if row.submitted_at.tzinfo else row.submitted_at.replace(tzinfo=timezone.utc)
            legacy_by_time[(row.source.value, at.astimezone(timezone.utc))].append(row)

    headers = [str(h) for h in df.columns]
    new_count = 0
    updated_count = 0
    matched_count = 0
    staged_rows: list[tuple[list, dict, dict, object]] = []
    # Позиционный доступ: устойчиво к дублирующимся/пустым заголовкам листа
    for row_values in df.itertuples(index=False, name=None):
        values = list(row_values)
        mapped = map_row(headers, values, source)
        full_name = mapped.get("full_name", "")
        if not full_name:
            continue

        raw_data = {str(h).strip(): (str(v).strip() if v is not None else "") for h, v in zip(headers, values)}
        identity = source_identity(source.value, headers, values, raw_data)
        staged_rows.append((values, mapped, raw_data, identity))

    key_counts = Counter(row[3].key for row in staged_rows)
    digest_by_key: dict[str, set[str]] = defaultdict(set)
    for _, _, _, ident in staged_rows:
        digest_by_key[ident.key].add(ident.digest)
    seen_duplicate_content: set[tuple[str, str]] = set()
    duplicate_rows = 0

    for values, mapped, raw_data, identity in staged_rows:
        full_name = mapped["full_name"]
        duplicate = key_counts[identity.key] > 1
        # A collision at one timestamp is evidence that the source key is not
        # unique. Do not clear that evidence just because a later export omits
        # one of the conflicting rows or changes its contents.
        review_required = (
            identity.review_required
            or duplicate
            or _has_historical_identity_conflict(identity.key, set(rows_by_key))
        )
        if duplicate:
            content_key = (identity.key, identity.digest)
            if content_key in seen_duplicate_content:
                # Identical duplicate export rows are counted and collapsed.
                duplicate_rows += 1
                continue
            seen_duplicate_content.add(content_key)
        source_key = _staging_source_key(
            identity.key,
            identity.digest,
            duplicate=duplicate,
            conflicting_duplicate_content=len(digest_by_key[identity.key]) > 1,
            existing_keys=set(rows_by_key),
        )

        existing_submission = rows_by_key.get(source_key)
        if existing_submission is None:
            # Migrate a pre-existing staging row in place when its old
            # timestamp/name fingerprint identifies this same response.
            legacy_fp = row_fingerprint(source.value, mapped.get("timestamp", ""), full_name)
            legacy = legacy_by_fp.get(legacy_fp) if not duplicate else None
            if legacy is None and not duplicate:
                submitted_at = _parse_timestamp(mapped.get("timestamp", ""))
                if submitted_at:
                    candidates = legacy_by_time.get((source.value, submitted_at.astimezone(timezone.utc)), [])
                    if len(candidates) == 1:
                        legacy = candidates[0]
            if legacy and legacy.source_key is None:
                existing_submission = legacy

        match_candidates = plausible_student_candidates(full_name, mapped.get("phone", ""), students_index)
        phone_norm = normalize_phone(mapped.get("phone", "")) or None
        fp = hashlib.sha256(f"{source_key}|{identity.digest}".encode()).hexdigest()
        now = datetime.now(timezone.utc)

        if existing_submission is not None:
            identity_changed = (
                " ".join(str(existing_submission.full_name or "").casefold().split())
                != " ".join(str(full_name or "").casefold().split())
                or (existing_submission.phone_normalized or "") != (phone_norm or "")
            )
            if existing_submission.status != IntakeStatus.new:
                # Preserve manual links/ignored decisions even if a form row is edited.
                changed = existing_submission.content_hash != identity.digest
                if changed:
                    existing_submission.content_revision = (existing_submission.content_revision or 1) + 1
                    existing_submission.content_changed_at = now
                existing_submission.raw_data = raw_data
                existing_submission.content_hash = identity.digest
                existing_submission.source_key = source_key
                existing_submission.full_name = full_name[:500]
                existing_submission.phone_normalized = phone_norm
                existing_submission.manager_name = (mapped.get("manager_name") or "")[:200] or None
                existing_submission.identity_review_required = (
                    existing_submission.identity_review_required or review_required or identity_changed
                )
                existing_submission.last_seen_at = now
                rows_by_key[source_key] = existing_submission
                updated_count += int(changed)
                continue
            changed = existing_submission.content_hash != identity.digest
            if changed:
                existing_submission.content_revision = (existing_submission.content_revision or 1) + 1
                existing_submission.content_changed_at = now
                existing_submission.row_fingerprint = fp
            existing_submission.source_key = source_key
            existing_submission.content_hash = identity.digest
            existing_submission.raw_data = raw_data
            existing_submission.full_name = full_name[:500]
            existing_submission.phone_normalized = phone_norm
            existing_submission.manager_name = (mapped.get("manager_name") or "")[:200] or None
            existing_submission.suggested_student_id = (
                match_candidates.student_ids[0] if len(match_candidates.student_ids) == 1 else None
            )
            existing_submission.suggested_confidence = match_candidates.confidence or None
            existing_submission.match_candidate_ids = [str(v) for v in match_candidates.student_ids]
            existing_submission.identity_review_required = (
                existing_submission.identity_review_required or review_required or identity_changed
            )
            existing_submission.last_seen_at = now
            updated_count += int(changed)
            matched_count += int(bool(match_candidates.student_ids))
            rows_by_key[source_key] = existing_submission
            continue

        submission = IntakeSubmission(
            source=source,
            submitted_at=_parse_timestamp(mapped.get("timestamp", "")),
            row_fingerprint=fp,
            source_key=source_key,
            content_hash=identity.digest,
            content_revision=1,
            content_changed_at=now,
            first_seen_at=now,
            last_seen_at=now,
            identity_review_required=review_required,
            match_candidate_ids=[str(v) for v in match_candidates.student_ids],
            raw_data=raw_data,
            full_name=full_name[:500],
            phone_normalized=phone_norm,
            manager_name=(mapped.get("manager_name") or "")[:200] or None,
            suggested_student_id=match_candidates.student_ids[0] if len(match_candidates.student_ids) == 1 else None,
            suggested_confidence=round(match_candidates.confidence, 3) if match_candidates.student_ids else None,
            status=IntakeStatus.new,
        )
        db.add(submission)
        rows_by_key[source_key] = submission
        new_count += 1
        if match_candidates.student_ids:
            matched_count += 1

    await db.commit()
    return {
        "total_rows": len(df), "new": new_count, "updated": updated_count,
        "matched": matched_count, "duplicate_rows": duplicate_rows,
    }


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

            required_sources = {"package", "cases"}
            missing_sources = required_sources - set(dfs)
            sheets_read_complete = not missing_sources

            students_index = await load_students_index(db)
            counters: dict = {}
            if "package" in dfs:
                counters["package"] = await _ingest_dataframe(db, dfs["package"], IntakeSource.package, students_index)
            if "cases" in dfs:
                counters["cases"] = await _ingest_dataframe(db, dfs["cases"], IntakeSource.cases, students_index)

            if not counters:
                raise RuntimeError(
                    "Таблицы форм не найдены — проверь, что обе таблицы расшарены на email сервисного аккаунта"
                )
            counters["complete_sources"] = sorted(set(dfs))
            counters["source_read_complete"] = sheets_read_complete
            if missing_sources:
                counters["missing_sources"] = sorted(missing_sources)

            # Creation is opt-in, delayed, and requires a successful Notion read
            # newer than first_seen. This invocation proves both Sheets forms
            # were read completely; it does not itself write to Google/Notion.
            if settings.ENABLE_INTAKE_AUTO_CREATE or settings.ENABLE_INTAKE_AUTO_LINK:
                from app.services.intake_promote import promote_new_submissions

                try:
                    promoted = await promote_new_submissions(
                        db, actor_id=None, automatic=True,
                        sheets_completed_at=(datetime.now(timezone.utc) if sheets_read_complete else None),
                    )
                    # Счётчик проставляем только после успешного коммита: иначе
                    # упавший коммит оставил бы в статусе «создано N» при нуле
                    # реально созданных карточек.
                    await db.commit()
                    counters["promoted"] = promoted
                except Exception:
                    await db.rollback()
                    logger.exception("Intake auto-create failed after sheets sync")

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
