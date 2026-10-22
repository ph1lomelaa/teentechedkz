"""Read-only, reproducible preflight for the existing field-sync outbox."""
from __future__ import annotations

import hashlib
import json
from sqlalchemy import select
from app.models import Student, Contract, NotionSnapshot
from app.models.notion_snapshot import NotionMatchStatus
from app.services.notion_sync import EDITABLE_FIELDS, editable_canon
from app.services.notion_field_sync_policy import reconcile_field
from app.services.notion_field_sync_runtime import CONTRACT_FIELD_ATTR, MONEY_FIELDS

FIELD_LABELS = {
    "full_name": "ФИО", "phone": "Телефон", "degree_level": "Ступень", "intake_year": "Набор",
    "pipeline_status": "Статус", "signed_date": "Дата договора", "client_fee": "Сумма договора",
    "english_sum": "Сумма английского", "english_paid": "Оплачено за английский",
    "mentor_total": "Всего ментору", "client_remaining": "Остаток клиента",
    "client_remaining_date": "Дата остатка клиента",
}


def describe_field(field, *, crm, notion, baseline, has_baseline, contract_count=1, contract_currency="KZT"):
    result = reconcile_field(baseline=baseline, has_baseline=has_baseline, crm_value=crm, notion_value=notion)
    reason = None
    eligible = result.can_propagate
    if field in CONTRACT_FIELD_ATTR and contract_count != 1:
        eligible = False
        reason = "Нужен один однозначно определённый договор"
    elif field in MONEY_FIELDS and contract_currency != "KZT":
        eligible = False
        reason = "Валюта договора отличается от KZT; нужна сверка денежных колонок Notion"
    elif result.decision.value == "unknown_baseline":
        reason = "Нет общего эталона и достоверной истории поля"
    elif result.decision.value == "conflict" and result.winner is None:
        reason = "Обе стороны изменились; время изменения поля не установлено"
    elif result.decision.value == "unsafe_clear":
        reason = "Очистка поля требует проверки"
    return {
        "field_key": field, "label": FIELD_LABELS[field], "crm": crm, "notion": notion,
        "baseline": baseline, "has_baseline": has_baseline, "decision": result.decision.value,
        "winner": result.winner.value if eligible and result.winner else None,
        "eligible": eligible, "reason": reason,
    }


async def build_report(db, *, student_id=None, allowed_ids=None, include_contract=True):
    query = select(NotionSnapshot).where(NotionSnapshot.status == NotionMatchStatus.linked, NotionSnapshot.student_id.is_not(None))
    if student_id:
        query = query.where(NotionSnapshot.student_id == student_id)
    if allowed_ids is not None:
        query = query.where(NotionSnapshot.student_id.in_(allowed_ids))
    snapshots = (await db.execute(query.order_by(NotionSnapshot.id))).scalars().all()
    ids = {s.student_id for s in snapshots}
    students = {s.id: s for s in (await db.execute(select(Student).where(Student.id.in_(ids)))).scalars().all()} if ids else {}
    contracts = {}
    if ids and include_contract:
        for contract in (await db.execute(select(Contract).where(Contract.student_id.in_(ids)).order_by(Contract.created_at.desc()))).scalars().all():
            contracts.setdefault(contract.student_id, []).append(contract)
    rows = []
    for snapshot in snapshots:
        student = students.get(snapshot.student_id)
        if not student or student.is_archived:
            continue
        agreements = contracts.get(student.id, [])
        contract = agreements[0] if agreements else None
        values = editable_canon(snapshot.normalized_data or {}, student, contract)
        baseline = snapshot.synced_baseline or {}
        fields = []
        for field in EDITABLE_FIELDS:
            if field in CONTRACT_FIELD_ATTR and not include_contract:
                continue
            notion, crm = values[field]
            fields.append(describe_field(field, crm=crm, notion=notion, baseline=baseline.get(field), has_baseline=field in baseline, contract_count=len(agreements), contract_currency=contract.currency if contract else "KZT"))
        rows.append({
            "student_id": str(student.id), "student_name": student.full_name,
            "snapshot_id": str(snapshot.id), "notion_page_id": snapshot.notion_page_id,
            "synced_at": snapshot.synced_at.isoformat() if snapshot.synced_at else None,
            "contract_id": str(contract.id) if contract else None, "fields": fields,
        })
    revision = hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    fields = [field for row in rows for field in row["fields"]]
    return {
        "revision": revision, "students": len(rows), "ready": sum(f["eligible"] for f in fields),
        "review": sum(f["decision"] != "resolved" and not f["eligible"] for f in fields),
        "rows": rows,
        "excluded": ["Назначения сотрудников", "Страны и связи", "Вычисляемые поля Notion", "Документы и содержимое Roadmap"],
    }
