"""Студент платформы → новая строка в Notion «Весь пайплайн клиентов».

Когда у студента без связи с Notion появляется статус (не «Без статуса»),
worker создаёт в Notion страницу с теми же колонками, что у остальных строк,
и сразу привязывает её. Дальше значения ведёт обычный двусторонний обмен
полями (`notion_field_sync_runtime`): правка года, ступени, статуса и т.п. на
платформе уходит в Notion сама.

Защита от дублей, по порядку:
0. только если статус поставил сотрудник (см. students_with_manual_status, без
   ограничения по дате) —
   статус из договора TrustMe или скрипта страницу не создаёт;
1. в зеркале Notion (`notion_snapshots`) есть похожая строка (ФИО или телефон)
   → страница НЕ создаётся, студент ждёт ручной привязки;
2. в самом Notion уже есть страница с точно таким заголовком → одна —
   привязываем её, несколько — ждём человека;
3. страница и её snapshot пишутся в одной транзакции; если коммит упал после
   создания страницы, следующий проход найдёт её по заголовку (п. 2) и привяжет.

Распределение (Mentors, Lead-Mentor) и формулы не пишутся никогда.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.core.config import settings
from app.models.application import Application
from app.models.contract import Contract, PipelineStatus
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
from app.models.student import Student
from app.models.user import User
from app.services import notion_write
from migration.transformers.normalize import names_probably_same, normalize_phone

logger = logging.getLogger(__name__)

ACTOR = "notion_create"

# Поля, которые пишутся при создании (те же ключи, что у обмена полями).
CREATE_FIELDS = (
    "full_name", "phone", "degree_level", "intake_year", "pipeline_status",
    "signed_date", "client_fee", "english_sum", "english_paid",
    "client_remaining", "client_remaining_date",
)

# Страна платформы → ключ опции Notion (опции вида «🇰🇷 Korea»).
_COUNTRY_KEYS = {
    "италия": "italy", "корея": "korea", "южная корея": "korea", "китай": "china",
    "гонконг": "hong kong", "сша": "usa", "германия": "germany", "малайзия": "malaysia",
    "малазия": "malaysia", "венгрия": "hungary", "великобритания": "uk", "англия": "england",
    "катар": "qatar", "япония": "japan", "оаэ": "uae", "эмираты": "uae", "турция": "turkey",
    "канада": "canada", "австрия": "austria", "польша": "poland", "франция": "france",
    "испания": "spain", "сингапур": "singapore", "чехия": "czech", "эрасмус": "эрасмус",
    "ну": "ну",
}


def _option_key(text: str) -> str:
    """«🇰🇷 Korea» → «korea»: только буквы и пробелы, нижний регистр."""
    cleaned = re.sub(r"[^\w\s]", " ", str(text or ""), flags=re.UNICODE)
    cleaned = re.sub(r"[\d_]", " ", cleaned)
    return " ".join(cleaned.lower().split())


def country_option(country: str, options: list[str]) -> str | None:
    key = _option_key(country)
    key = _COUNTRY_KEYS.get(key, key)
    for option in options:
        if _option_key(option) == key:
            return option
    return None


def _multi_options(schema: dict, real_name: str) -> list[str]:
    prop = schema.get(real_name, {})
    return [o.get("name") for o in prop.get("multi_select", {}).get("options", []) if o.get("name")]


def _since() -> datetime | None:
    raw = (settings.NOTION_CREATE_PAGES_SINCE or "").strip()
    if not raw:
        return None
    try:
        value = datetime.fromisoformat(raw)
    except ValueError:
        logger.error("NOTION_CREATE_PAGES_SINCE=%r не дата ISO — автосоздание выключено", raw)
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _latest_contract_subquery():
    return (
        select(Contract.pipeline_status)
        .where(Contract.student_id == Student.id)
        .order_by(Contract.created_at.desc(), Contract.id.desc())
        .limit(1)
        .scalar_subquery()
    )


async def eligible_students(db: AsyncSession, *, student_ids=None, limit: int = 20) -> list[Student]:
    """Студенты без связи с Notion и со статусом (не «Без статуса»)."""
    status = _latest_contract_subquery()
    linked = exists().where(and_(
        NotionSnapshot.student_id == Student.id,
        NotionSnapshot.status == NotionMatchStatus.linked,
    ))
    query = (
        select(Student)
        .where(Student.is_archived.is_(False), ~linked, status.is_not(None), status != PipelineStatus.no_status)
        .order_by(Student.created_at)
        .limit(limit)
    )
    if student_ids is not None:
        query = query.where(Student.id.in_(list(student_ids)))
    return list((await db.execute(query)).scalars().all())


async def similar_snapshots(db: AsyncSession, student: Student) -> list[NotionSnapshot]:
    """Строки зеркала Notion, похожие на студента по ФИО или телефону."""
    phone = normalize_phone(student.phone or "")
    rows = (await db.execute(select(NotionSnapshot).where(NotionSnapshot.full_name.is_not(None)))).scalars().all()
    out = []
    for row in rows:
        same_phone = bool(phone) and row.phone_normalized == phone
        same_name = names_probably_same(row.full_name or "", student.full_name or "") or (
            " ".join((row.full_name or "").casefold().split())
            == " ".join((student.full_name or "").casefold().split())
        )
        if same_name or same_phone:
            out.append(row)
    return out


async def build_properties(db: AsyncSession, student: Student, contract: Contract | None, schema: dict) -> dict:
    from app.services.notion_field_sync_runtime import (
        _crm_raw, _crm_to_notion_payload, _resolve_notion_property,
    )
    properties: dict[str, dict] = {}
    from app.services.notion_field_sync_runtime import CONTRACT_FIELD_ATTR, MONEY_FIELDS
    kzt = contract is not None and (contract.currency or "KZT").upper() == "KZT"
    for field in CREATE_FIELDS:
        if field in CONTRACT_FIELD_ATTR and contract is None:
            continue
        # Суммы в Notion — тенге; договор в другой валюте не переносим.
        if field in MONEY_FIELDS and not kzt:
            continue
        resolved = _resolve_notion_property(field, schema, require_writable=True)
        if resolved is None:
            continue
        real_name, prop_type = resolved
        value = _crm_raw(field, student, contract)
        if value is None or value == "":
            continue
        if field == "phone":
            from app.services.notion_field_sync_runtime import phone_requires_review
            # Два номера / «(мама)» в одной ячейке не пишем: в Notion это поле — один номер.
            if not normalize_phone(str(value)) or phone_requires_review(value):
                continue
            if prop_type == "phone_number":
                value = str(value).strip()
        payload = _crm_to_notion_payload(field, value, schema, real_name, prop_type)
        if payload is not None:
            properties[real_name] = payload

    # Страны: основная — Main country, остальные — Other countries.
    apps = (await db.execute(
        select(Application.country, Application.is_primary)
        .where(Application.student_id == student.id)
        .order_by(Application.is_primary.desc(), Application.country)
    )).all()
    countries = [c for c, _ in apps if c]
    if countries:
        main_name, main_type = notion_write.resolve_property(schema, "Main country")
        other_name, other_type = notion_write.resolve_property(schema, "Other countries")
        if main_name and main_type == "multi_select":
            main = country_option(countries[0], _multi_options(schema, main_name))
            if main:
                properties[main_name] = notion_write.build_property("multi_select", [main])
        if other_name and other_type == "multi_select" and len(countries) > 1:
            opts = _multi_options(schema, other_name)
            others = [o for o in (country_option(c, opts) for c in countries[1:]) if o]
            others = list(dict.fromkeys(others))
            if others:
                properties[other_name] = notion_write.build_property("multi_select", others)

    # МЗК — select с именами; пишем, только если имя менеджера совпало с опцией.
    if contract is not None and contract.mzk_manager_id:
        manager = await db.get(User, contract.mzk_manager_id)
        mzk_name, mzk_type = notion_write.resolve_property(schema, "МЗК")
        if manager and mzk_name and mzk_type == "select":
            first = (manager.name or "").split()
            options = notion_write.select_options(schema, mzk_name)
            match = next((o for o in options if first and o.casefold() in {w.casefold() for w in first}), None)
            if match:
                properties[mzk_name] = notion_write.build_property("select", match)
    return properties


def _page_to_snapshot_row(page: dict) -> tuple[dict, dict]:
    from migration.sources.notion import transform_notion_records
    row = transform_notion_records([page])[0]
    raw = row.pop("raw_properties")
    return row, raw


async def _attach_page(db: AsyncSession, student: Student, contract: Contract | None, page: dict, *, created: bool) -> NotionSnapshot:
    from app.services.notion_sync import _parse_iso, reconcile_baseline
    row, raw = _page_to_snapshot_row(page)
    snapshot = (await db.execute(
        select(NotionSnapshot).where(NotionSnapshot.notion_page_id == row["notion_page_id"])
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if snapshot is None:
        snapshot = NotionSnapshot(notion_page_id=row["notion_page_id"], first_seen_at=now,
                                  raw_properties={}, normalized_data={})
        db.add(snapshot)
    snapshot.notion_url = row.get("notion_url")
    snapshot.full_name = (row.get("full_name") or "")[:500] or None
    snapshot.phone_normalized = normalize_phone(row.get("phone", "")) or None
    snapshot.raw_properties = raw
    snapshot.normalized_data = row
    snapshot.notion_last_edited_at = _parse_iso(row.get("last_edited_time"))
    snapshot.synced_at = now
    snapshot.student_id = student.id
    snapshot.suggested_student_id = student.id
    snapshot.suggested_confidence = 1.0
    snapshot.status = NotionMatchStatus.linked
    snapshot.linked_at = now
    snapshot.manual_unlink = False
    await db.flush()
    # Записанные значения сразу становятся согласованным эталоном обмена полями.
    reconcile_baseline(snapshot, student, contract)
    await log_change(
        db, "student", student.id, "notion_page_created" if created else "notion_page_linked",
        None, row.get("notion_url") or row["notion_page_id"], ACTOR, "notion",
    )
    return snapshot


async def create_page_for_student(db: AsyncSession, student: Student, *, dry_run: bool = False) -> dict:
    """Создать/привязать страницу Notion одному студенту. Коммит — на вызывающем."""
    contract = (await db.execute(
        select(Contract).where(Contract.student_id == student.id)
        .order_by(Contract.created_at.desc(), Contract.id.desc()).limit(1)
    )).scalar_one_or_none()
    linked = (await db.execute(select(func.count()).select_from(NotionSnapshot).where(
        NotionSnapshot.student_id == student.id, NotionSnapshot.status == NotionMatchStatus.linked,
    ))).scalar_one()
    if linked:
        return {"state": "already_linked"}
    if contract is None or contract.pipeline_status in (None, PipelineStatus.no_status):
        return {"state": "no_status"}
    similar = await similar_snapshots(db, student)
    if similar:
        return {"state": "similar_in_notion", "similar": [
            {"name": s.full_name, "status": s.status.value, "url": s.notion_url,
             "student_id": str(s.student_id) if s.student_id else None} for s in similar[:5]
        ]}

    loop = asyncio.get_running_loop()
    title = (student.full_name or "").strip()
    remote = await loop.run_in_executor(None, notion_write.find_pages_by_title, title)
    if len(remote) > 1:
        return {"state": "several_in_notion", "count": len(remote)}
    if len(remote) == 1:
        if dry_run:
            return {"state": "would_link", "url": remote[0].get("url")}
        snapshot = await _attach_page(db, student, contract, remote[0], created=False)
        return {"state": "linked_existing", "url": snapshot.notion_url}

    schema = await loop.run_in_executor(None, notion_write.get_schema)
    properties = await build_properties(db, student, contract, schema)
    if dry_run:
        return {"state": "would_create", "properties": properties}
    page = await loop.run_in_executor(
        None, notion_write.create_page, properties, settings.NOTION_CREATE_PAGES_TEMPLATE_ID or None,
    )
    snapshot = await _attach_page(db, student, contract, page, created=True)
    return {"state": "created", "url": snapshot.notion_url}


async def students_with_manual_status(db: AsyncSession, student_ids, since: datetime | None = None) -> set:
    """Кому статус поставил СОТРУДНИК (в карточке/списке) — когда угодно.

    Статус, проставленный скриптом, договором TrustMe или синком, страницу в
    Notion не создаёт: сначала карточку проверяет менеджер и сам ставит статус.
    `changed_by` у ручной правки — id пользователя; у автоматики — имя процесса.
    """
    from app.models.status_history import StatusHistory
    if not student_ids:
        return set()
    contract_ids = select(Contract.id).where(Contract.student_id.in_(list(student_ids)))
    rows = (await db.execute(
        select(Contract.student_id, StatusHistory.changed_by, StatusHistory.new_value)
        .join(StatusHistory, and_(StatusHistory.entity_id == Contract.id,
                                  StatusHistory.entity_type == "contract",
                                  # «created» — договор создан сразу со статусом (contracts.py).
                                  StatusHistory.field_changed.in_(("pipeline_status", "created"))))
        .where(Contract.id.in_(contract_ids))
    )).all()
    out = set()
    for student_id, changed_by, new_value in rows:
        try:
            uuid.UUID(str(changed_by))
        except (TypeError, ValueError):
            continue
        if new_value and new_value != PipelineStatus.no_status.value:
            out.add(student_id)
    return out


async def process_pending(db: AsyncSession, *, limit: int = 10) -> dict:
    """Проход worker: создать страницы для подходящих студентов."""
    if not settings.ENABLE_NOTION_CREATE_PAGES:
        return {"state": "disabled"}
    allow = {uuid.UUID(str(v)) for v in settings.NOTION_CREATE_PAGES_STUDENT_IDS}
    candidates = await eligible_students(db, limit=200)
    # Граница по дате убрана (12.11): статус, поставленный сотрудником, отправляет
    # студента в Notion всегда — иначе правка «на стыке» дат терялась молча.
    manual = await students_with_manual_status(db, [s.id for s in candidates])
    picked = [s for s in candidates if s.id in allow or s.id in manual]
    counts: dict[str, int] = {}
    for student in picked[:limit]:
        try:
            result = await create_page_for_student(db, student)
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("Не удалось создать страницу Notion для %s", student.id)
            result = {"state": "error"}
        counts[result["state"]] = counts.get(result["state"], 0) + 1
        if result["state"] in ("created", "linked_existing"):
            logger.info("Notion: %s → %s (%s)", student.full_name, result.get("url"), result["state"])
    return counts


def mzk_option_for(user_name: str | None, options: list[str]) -> str | None:
    """«Тулегенова Зере» → опция «Зере»: любое слово имени совпало с опцией."""
    words = {w.casefold() for w in (user_name or "").split()}
    return next((o for o in options if o.casefold() in words), None)


async def sync_mzk_assignments(db: AsyncSession, *, limit: int = 20) -> dict:
    """Назначенный на платформе МЗК → колонка «МЗК» в Notion.

    Берутся только назначения, сделанные после NOTION_CREATE_PAGES_SINCE: старые
    расхождения массово не перезаписываются. Направление одно — платформа →
    Notion; снятие МЗК Notion не очищает. Повторный проход ничего не пишет:
    значение сравнивается с последним прочитанным из Notion.
    """
    from app.models.mentor_assignment import MentorAssignment, MentorRole
    since = _since()
    if since is None:
        return {"state": "no_scope"}
    rows = (await db.execute(
        select(MentorAssignment.student_id, User.name, NotionSnapshot)
        .join(User, User.id == MentorAssignment.mentor_id)
        .join(NotionSnapshot, and_(NotionSnapshot.student_id == MentorAssignment.student_id,
                                   NotionSnapshot.status == NotionMatchStatus.linked))
        .where(MentorAssignment.role == MentorRole.mzk, MentorAssignment.is_active.is_(True),
               MentorAssignment.assigned_at >= since)
        .order_by(MentorAssignment.assigned_at.desc())
    )).all()
    if not rows:
        return {"state": "nothing"}
    loop = asyncio.get_running_loop()
    schema = await loop.run_in_executor(None, notion_write.get_schema)
    real_name, ptype = notion_write.resolve_property(schema, "МЗК")
    if not real_name or ptype != "select":
        return {"state": "no_property"}
    options = notion_write.select_options(schema, real_name)
    seen, written = set(), 0
    for student_id, user_name, snapshot in rows:
        if student_id in seen or written >= limit:
            continue
        seen.add(student_id)
        links = (await db.execute(select(func.count()).select_from(NotionSnapshot).where(
            NotionSnapshot.student_id == student_id, NotionSnapshot.status == NotionMatchStatus.linked))).scalar_one()
        if links != 1:
            continue
        option = mzk_option_for(user_name, options)
        current = (snapshot.normalized_data or {}).get("mzk")
        if option is None or current == option:
            continue
        await loop.run_in_executor(None, notion_write.update_page, snapshot.notion_page_id,
                                   {real_name: notion_write.build_property("select", option)})
        data = dict(snapshot.normalized_data or {}); data["mzk"] = option
        snapshot.normalized_data = data
        await log_change(db, "student", student_id, "notion_push:mzk", current, option, ACTOR, "notion")
        await db.commit()
        written += 1
        logger.info("Notion МЗК: %s → %s", student_id, option)
    return {"state": "ok", "written": written}
