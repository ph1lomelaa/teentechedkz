"""Read-only preflight and shared context for the CRM/Notion synchronizer."""
from __future__ import annotations

import hashlib
import json
import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from collections import Counter
from sqlalchemy import select, func
from app.models import Student, Contract, NotionSnapshot
from app.models.notion_snapshot import NotionMatchStatus
from app.models.status_history import StatusHistory
from app.models.notion_field_sync import NotionFieldSync, FieldSyncStatus
from app.services import notion_write
from app.services.notion_field_sync_runtime import _resolve_notion_property, _crm_to_notion_payload, _SNAPSHOT_VALUE_KEY
from app.core.config import settings
from app.services.notion_sync import EDITABLE_FIELDS, editable_canon
from app.services.notion_field_sync_policy import reconcile_shared_field
from app.services.notion_field_sync_runtime import CONTRACT_FIELD_ATTR, MONEY_FIELDS, canonical_profile_value

FIELD_LABELS = {
    "full_name": "ФИО", "phone": "Телефон", "degree_level": "Ступень", "intake_year": "Набор",
    "pipeline_status": "Статус", "signed_date": "Дата договора", "client_fee": "Сумма договора",
    "english_sum": "Сумма английского", "english_paid": "Оплачено за английский",
    "mentor_total": "Всего ментору", "client_remaining": "Остаток клиента",
    "client_remaining_date": "Дата остатка клиента",
}


def describe_field(field, *, crm, notion, baseline, has_baseline, contract_count=1,
                   contract_currency="KZT", initialized=True, manual_edit=False, blocked=None):
    result = reconcile_shared_field(field_key=field, initialized=initialized, manual_edit=manual_edit,
        baseline=baseline, has_baseline=has_baseline, crm_value=crm, notion_value=notion)
    reason = blocked
    if field in CONTRACT_FIELD_ATTR and field != "pipeline_status" and contract_count != 1:
        reason = "Нужен один однозначно определённый договор"
    elif field in MONEY_FIELDS and contract_currency != "KZT":
        reason = "Валюта договора отличается от KZT; нужна сверка денежных колонок Notion"
    elif reason is None:
        if result.decision.value == "unknown_baseline":
            reason = "Нет общего эталона; подтверждённую ручную правку сохраняем для разбора"
        elif result.decision.value == "conflict" and result.winner is None:
            reason = "Обе стороны изменились; время изменения поля не установлено"
        elif result.decision.value == "unsafe_clear":
            reason = "Очистка поля требует проверки"
    eligible = result.can_propagate and reason is None
    return {
        "field_key": field, "label": FIELD_LABELS[field], "crm": crm, "notion": notion,
        "baseline": baseline, "has_baseline": has_baseline, "decision": result.decision.value,
        "winner": result.winner.value if eligible and result.winner else None,
        "eligible": eligible, "reason": reason,
    }


async def load_context(db, snapshots, *, include_contract=True):
    ids = {s.student_id for s in snapshots if s.student_id}
    if not ids:
        return {"students": {}, "contracts": {}, "duplicates": set(), "manual": {}}
    students = {s.id: s for s in (await db.execute(select(Student).where(Student.id.in_(ids)))).scalars().all()}
    contracts = {}
    if include_contract:
        for c in (await db.execute(select(Contract).where(Contract.student_id.in_(ids))
                .order_by(Contract.created_at.desc(), Contract.id.desc()))).scalars().all():
            contracts.setdefault(c.student_id, []).append(c)
    duplicates = set((await db.execute(select(NotionSnapshot.student_id).where(
        NotionSnapshot.student_id.in_(ids), NotionSnapshot.status == NotionMatchStatus.linked
    ).group_by(NotionSnapshot.student_id).having(func.count() > 1))).scalars().all())
    entity_ids = ids | {c.id for agreements in contracts.values() for c in agreements}
    audit_fields = set(EDITABLE_FIELDS) | set(CONTRACT_FIELD_ATTR.values())
    history = (await db.execute(select(StatusHistory).where(
        StatusHistory.entity_id.in_(entity_ids), StatusHistory.source == "manual",
        StatusHistory.field_changed.in_(audit_fields),
    ).order_by(StatusHistory.changed_at.desc(), StatusHistory.id.desc()))).scalars().all()
    manual = {}
    for audit in history:
        try:
            uuid.UUID(audit.changed_by)
        except (ValueError, TypeError, AttributeError):
            continue
        manual.setdefault((audit.entity_type, audit.entity_id, audit.field_changed), audit.new_value)
    intents = {}
    queued = (await db.execute(select(NotionFieldSync).where(
        NotionFieldSync.student_id.in_(ids),
        NotionFieldSync.status.in_([FieldSyncStatus.pending, FieldSyncStatus.processing, FieldSyncStatus.dry_run]),
    ).order_by(NotionFieldSync.created_at.desc()))).scalars().all()
    for item in queued:
        if item.source_revision.startswith(("manual-resolution:", "crm-edit:")):
            intents.setdefault((item.notion_snapshot_id, item.field_key), item)
    return {"students": students, "contracts": contracts, "duplicates": duplicates, "manual": manual, "intents": intents}


def manual_fields_for(context, student, contract, canon):
    fields = set()
    for field, (_, value) in canon.items():
        if field in CONTRACT_FIELD_ATTR:
            if contract is None:
                continue
            key = ("contract", contract.id, CONTRACT_FIELD_ATTR[field])
        else:
            key = ("student", student.id, field)
        if key in context["manual"] and canonical_profile_value(field, context["manual"][key]) == value:
            fields.add(field)
    return fields


async def build_report(db, *, student_id=None, allowed_ids=None, include_contract=True):
    query = select(NotionSnapshot).where(NotionSnapshot.status == NotionMatchStatus.linked, NotionSnapshot.student_id.is_not(None))
    if student_id:
        query = query.where(NotionSnapshot.student_id == student_id)
    if allowed_ids is not None:
        query = query.where(NotionSnapshot.student_id.in_(allowed_ids))
    snapshots = (await db.execute(query.order_by(NotionSnapshot.id))).scalars().all()
    context = await load_context(db, snapshots, include_contract=include_contract)
    schema = None
    schema_error = None
    if settings.NOTION_API_KEY and settings.NOTION_DATABASE_ID:
        try:
            schema = await asyncio.to_thread(notion_write.get_schema)
        except Exception:
            schema_error = "Не удалось проверить схему Notion; применение недоступно"
    else:
        schema_error = "Notion не настроен"
    rows = []
    archived = 0
    for snapshot in snapshots:
        student = context["students"].get(snapshot.student_id)
        if not student or student.is_archived:
            archived += 1
            continue
        agreements = context["contracts"].get(student.id, [])
        contract = agreements[0] if agreements else None
        values = editable_canon(snapshot.normalized_data or {}, student, contract)
        baseline = snapshot.synced_baseline or {}
        manual = manual_fields_for(context, student, contract, values)
        blocked = "Несколько страниц Notion у одного студента; сначала выберите источник" if student.id in context["duplicates"] else None
        fields = []
        for field in EDITABLE_FIELDS:
            if field in CONTRACT_FIELD_ATTR and not include_contract:
                continue
            notion, crm = values[field]
            raw_notion = (snapshot.normalized_data or {}).get(_SNAPSHOT_VALUE_KEY[field])
            invalid_notion = raw_notion not in (None, "") and canonical_profile_value(field, raw_notion) is None
            field_blocked = blocked or ("Значение Notion не распознано; нужна проверка" if invalid_notion else None)
            description = describe_field(field, crm=crm, notion=notion, baseline=baseline.get(field),
                has_baseline=field in baseline, contract_count=len(agreements),
                contract_currency=contract.currency if contract else None,
                initialized=field in baseline.get("_initialized_fields", []), manual_edit=field in manual,
                blocked=field_blocked)
            structural_block = field_blocked or (field in CONTRACT_FIELD_ATTR and field != "pipeline_status" and len(agreements) != 1) or (field in MONEY_FIELDS and (not contract or contract.currency != "KZT"))
            allowed_sides = []
            if not structural_block and schema is not None:
                read_property = _resolve_notion_property(field, schema, require_writable=False)
                if read_property and notion is not None and not (field == "pipeline_status" and notion == "no_status"):
                    allowed_sides.append("notion")
                write_property = _resolve_notion_property(field, schema, require_writable=True)
                if write_property and _crm_to_notion_payload(field, crm, schema, *write_property) is not None:
                    allowed_sides.append("crm")
            description["allowed_sides"] = allowed_sides
            intent = context.get("intents", {}).get((snapshot.id, field))
            if intent and intent.crm_value == crm and intent.notion_value == notion and not structural_block:
                description["winner"] = intent.winning_side
                description["eligible"] = intent.winning_side in allowed_sides
                if description["eligible"]:
                    description["reason"] = None
            problem = schema_error
            if schema is not None and description["decision"] != "resolved":
                resolved = _resolve_notion_property(field, schema, require_writable=description["winner"] == "crm")
                if resolved is None:
                    problem = "Свойство Notion не найдено или недоступно для записи"
                elif description["winner"] == "crm" and _crm_to_notion_payload(field, crm, schema, *resolved) is None:
                    problem = "Тип свойства или значение Notion не поддерживает безопасную запись"
            if problem and description["decision"] != "resolved":
                description["eligible"] = False
                description["reason"] = description["reason"] or problem
            fields.append(description)
        rows.append({
            "student_id": str(student.id), "student_name": student.full_name,
            "snapshot_id": str(snapshot.id), "notion_page_id": snapshot.notion_page_id,
            "synced_at": snapshot.synced_at.isoformat() if snapshot.synced_at else None,
            "contract_id": str(contract.id) if contract else None, "fields": fields,
        })
    revision = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    fields = [field for row in rows for field in row["fields"]]
    from app.services.notion_sync import last_run
    run = await last_run()
    directions = Counter(f["winner"] for f in fields if f["eligible"])
    at = datetime.fromisoformat(run["at"]) if run.get("at") else None
    fresh = bool(run.get("ok") and at and datetime.now(timezone.utc) - at <= timedelta(seconds=max(7200, settings.NOTION_SYNC_INTERVAL_SECONDS * 2)))
    return {
        "fresh": fresh,
        "revision": revision, "students": len({r["student_id"] for r in rows}),
        "ready": sum(f["eligible"] for f in fields),
        "review": sum(f["decision"] != "resolved" and not f["eligible"] for f in fields),
        "directions": dict(directions), "duplicate_students": len(context["duplicates"]),
        "archived_pages": archived, "last_read": run, "rows": rows,
        "excluded": ["Назначения сотрудников", "Страны и связи", "Вычисляемые поля Notion для записи", "Документы и содержимое Roadmap"],
    }
