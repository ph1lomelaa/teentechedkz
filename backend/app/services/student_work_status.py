"""One read policy for student lists, cards, distribution and exports.

Notion is primary when it has a recognized value. An empty Notion property
never hides an existing CRM status. Multiple links are exposed, never picked.
This module does not mutate either source.
"""
from collections import defaultdict

from sqlalchemy import select

from app.models.contract import Contract
from app.models.notion_snapshot import NotionMatchStatus, NotionSnapshot
from app.models.notion_field_sync import NotionFieldSync, FieldSyncStatus, FieldSyncDirection
from migration.transformers.normalize import parse_pipeline_status


def resolve_work_status(crm_status=None, snapshots=(), pending_status=None):
    crm = getattr(crm_status, "value", crm_status) or "no_status"
    links = list(snapshots)
    raw = str((links[0].normalized_data or {}).get("payment_status_raw") or "").strip() if len(links) == 1 else ""
    notion = None
    invalid = False
    if raw:
        try:
            notion = parse_pipeline_status(raw)
        except ValueError:
            invalid = True
    # A literal "no status" is missing too, not permission to erase CRM.
    filled = notion not in (None, "no_status")
    portal_intent = len(links) == 1 and (getattr(links[0], "synced_baseline", None) or {}).get("_portal_status") == crm and crm != notion
    pending_status = pending_status or ("portal_edit" if portal_intent else None)
    pending = pending_status is not None and crm != "no_status"
    status = crm if pending else notion if filled else crm
    state = "ambiguous_link" if len(links) > 1 else "not_linked" if not links else "unrecognized" if invalid else "empty" if not filled else "different" if crm not in ("no_status", notion) else "matched" if crm == notion else "crm_empty"
    return {
        "pipeline_status": status,
        "crm_status": crm,
        "notion_status": notion,
        "notion_status_raw": raw or None,
        "status_source": "crm" if pending else "notion" if filled else "crm" if crm != "no_status" else "none",
        "notion_linked": len(links) == 1,
        "status_sync_state": pending_status or state,
    }


async def load_work_statuses(db, student_ids=None):
    contracts_query = select(Contract.student_id, Contract.pipeline_status).order_by(
        Contract.created_at.desc(), Contract.id.desc())
    snapshots_query = select(NotionSnapshot).where(
        NotionSnapshot.status == NotionMatchStatus.linked,
        NotionSnapshot.student_id.is_not(None))
    if student_ids is not None:
        if not student_ids:
            return {}
        contracts_query = contracts_query.where(Contract.student_id.in_(student_ids))
        snapshots_query = snapshots_query.where(NotionSnapshot.student_id.in_(student_ids))
    contracts = {}
    for sid, status in (await db.execute(contracts_query)).all():
        contracts.setdefault(sid, status)
    snapshots = defaultdict(list)
    for snapshot in (await db.execute(snapshots_query)).scalars():
        snapshots[snapshot.student_id].append(snapshot)
    pending_query = select(NotionFieldSync).where(
        NotionFieldSync.field_key == "pipeline_status",
        NotionFieldSync.direction == FieldSyncDirection.crm_to_notion,
        NotionFieldSync.status.in_([FieldSyncStatus.pending, FieldSyncStatus.processing,
            FieldSyncStatus.dry_run, FieldSyncStatus.failed]),
    ).order_by(NotionFieldSync.created_at.desc())
    if student_ids is not None:
        pending_query = pending_query.where(NotionFieldSync.student_id.in_(student_ids))
    pending = {}
    for item in (await db.execute(pending_query)).scalars():
        crm = getattr(contracts.get(item.student_id), "value", contracts.get(item.student_id))
        if item.crm_value == crm:
            pending.setdefault(item.student_id, "sync_error" if item.status == FieldSyncStatus.failed else "pending")
    ids = set(student_ids) if student_ids is not None else contracts.keys() | snapshots.keys()
    return {sid: resolve_work_status(contracts.get(sid), snapshots[sid], pending.get(sid)) for sid in ids}
