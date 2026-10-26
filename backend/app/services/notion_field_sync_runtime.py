"""Conservative executor for the first supported CRM ↔ Notion profile fields.

This module is deliberately not a worker or scheduler. The caller claims items
through the feature-gated outbox service and owns the transaction/commit. Dry
run is the default. External writes use the existing ``notion_write`` schema,
optimistic read and verify helpers.
"""
from __future__ import annotations

import asyncio
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone, date
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_change
from app.models.notion_field_sync import FieldSyncDirection, FieldSyncStatus, NotionFieldSync
from app.models.notion_snapshot import NotionMatchStatus
from app.models.student import DegreeLevel
from app.models.contract import Contract, PipelineStatus
from app.services import notion_write
from app.services.notion_field_sync_outbox import KZT_CONTRACT_REQUIRED, SINGLE_CONTRACT_REQUIRED


class RuntimeDisposition(str, Enum):
    ready = "ready"  # Validated, no write because dry_run=True.
    applied = "applied"
    conflict = "conflict"  # Current data is unsafe/unrepresentable.
    superseded = "superseded"  # Live values changed since enqueue.
    unsupported = "unsupported"


@dataclass(frozen=True)
class RuntimeResult:
    disposition: RuntimeDisposition
    field_key: str
    detail: str


_FIELD_PROPERTY = {
    "full_name": None,  # Resolve the data source's title property by type.
    "phone": "Номер тел",
    "degree_level": "Degree",
    "intake_year": "Intake",
    "pipeline_status": "Статус выплат",
    "signed_date": "Date of Agreement",
    "client_fee": "Client fee",
    "english_sum": "Сумм Англ",
    "english_paid": "PAID Англ",
    "client_remaining": "Остаток клиента",
    "client_remaining_date": "Остаток клиента (дата)",
    "mentor_total": "TOTAL (Mentors)",
}
CONTRACT_FIELD_ATTR = {
    "pipeline_status": "pipeline_status", "signed_date": "signed_date",
    "client_fee": "amount", "english_sum": "english_sum", "english_paid": "english_paid",
    "client_remaining": "client_remaining_amount", "client_remaining_date": "client_remaining_date",
    "mentor_total": "mentor_total_owed",
}
MONEY_FIELDS = frozenset({"client_fee", "english_sum", "english_paid", "client_remaining", "mentor_total"})
DATE_FIELDS = frozenset({"signed_date", "client_remaining_date"})

_SNAPSHOT_VALUE_KEY = {
    "full_name": "full_name",
    "phone": "phone",
    "degree_level": "degree_raw",
    "intake_year": "intake_raw",
    "pipeline_status": "payment_status_raw", "signed_date": "date_of_agreement",
    "client_fee": "client_fee", "english_sum": "english_sum", "english_paid": "english_paid",
    "client_remaining": "client_remaining", "client_remaining_date": "client_remaining_date",
    "mentor_total": "mentor_total",
}


def phone_requires_review(value: Any) -> bool:
    """Do not overwrite free-text notes or a second number in a phone cell."""
    raw = str(value or "").strip()
    digits = re.sub(r"\D", "", raw)
    return bool(re.search(r"[^0-9+()\s.\-]", raw) or "\n" in raw or raw.count("+") > 1
                or len(digits) > 15 or (len(digits) > 11 and digits.startswith(("7", "8"))))


SHARED_PHONE_REASON = "Телефон в Notion указан у нескольких страниц; общий номер не переносим"


def shared_phones(phones: Iterable[str | None]) -> set[str]:
    """Номер с нескольких страниц Notion — контакт менеджера или родителя, а не ученика.

    Такой номер не годится ни для привязки страницы к карточке, ни для переноса
    в карточку: иначе один общий номер склеивает разных учеников.
    """
    counts = Counter(phone for phone in phones if phone)
    return {phone for phone, total in counts.items() if total > 1}


async def load_shared_phones(session: AsyncSession) -> set[str]:
    from sqlalchemy import select

    from app.models.notion_snapshot import NotionSnapshot
    return shared_phones((await session.execute(select(NotionSnapshot.phone_normalized))).scalars())


def degree_is_note(raw: Any) -> bool:
    """В колонке «Ступень» заметка вместо ступени («Улучшение портфолио», «not decided yet»).

    Её не переносим ни в одну сторону: иначе платформа затёрла бы заметку
    менеджера ступенью, а пустую ступень — заметкой.
    """
    return raw not in (None, "") and canonical_profile_value("degree_level", raw) is None


def snapshot_phone_raw(snapshot: Any) -> Any:
    for key, value in (getattr(snapshot, "raw_properties", None) or {}).items():
        if key.strip().lower() == "номер тел":
            return value
    return (snapshot.normalized_data or {}).get("phone")


def _parse_intake(value: Any) -> str | None:
    text = str(value or "").replace(".", " ")
    for token in text.split():
        if token.isdigit() and 1900 <= int(token) <= 2200:
            return str(int(token))
    return None


def canonical_profile_value(field: str, value: Any) -> str | None:
    """Canonical JSON scalar shared by the outbox policy and runtime guard."""
    if isinstance(value, Enum):
        value = value.value
    if field == "pipeline_status" and value in (None, ""):
        return "no_status"
    if value in (None, ""):
        return None
    if field == "full_name":
        return " ".join(str(value).lower().split()) or None
    if field == "phone":
        from migration.sources.notion import clean_phone
        return clean_phone(value) or None
    if field == "degree_level":
        from migration.transformers.normalize import parse_degree_or_none
        try:
            return parse_degree_or_none(str(value))
        except (TypeError, ValueError):
            return None
    if field == "pipeline_status":
        from migration.transformers.normalize import parse_pipeline_status
        if str(value) in {status.value for status in PipelineStatus}:
            return str(value)
        try:
            return parse_pipeline_status(str(value))
        except ValueError:
            return None
    if field == "intake_year":
        return _parse_intake(value)
    if field in MONEY_FIELDS:
        try:
            amount = Decimal(str(value).replace(" ", "").replace(",", "."))
            return format(amount.quantize(Decimal("0.01")), ".2f") if amount.is_finite() and abs(amount) < Decimal("10000000000000000") and amount == amount.quantize(Decimal("0.01")) else None
        except (InvalidOperation, ValueError):
            return None
    if field in DATE_FIELDS:
        try:
            return date.fromisoformat(str(value)[:10]).isoformat()
        except ValueError:
            return None
    return None


def _crm_raw(field: str, student: Any, contract: Any = None) -> Any:
    if field in CONTRACT_FIELD_ATTR:
        return getattr(contract, CONTRACT_FIELD_ATTR[field], None)
    if field == "full_name":
        return student.full_name
    if field == "phone":
        return student.phone
    if field == "degree_level":
        value = student.degree_level
        return value.value if value is not None else None
    if field == "intake_year":
        return student.intake_year
    raise KeyError(field)


def _matches_expected(field: str, actual: Any, expected: Any) -> bool:
    return canonical_profile_value(field, actual) == canonical_profile_value(field, expected)


def _resolve_notion_property(
    field: str, schema: dict[str, dict], *, require_writable: bool
) -> tuple[str, str] | None:
    wanted = _FIELD_PROPERTY[field]
    if wanted is None:
        name, prop_type = notion_write.find_title_property(schema)
    else:
        name, prop_type = notion_write.resolve_property(schema, wanted)
    if not name or (require_writable and prop_type not in notion_write.WRITABLE_TYPES):
        return None
    return name, prop_type


def _select_option_for(field: str, notion_write_module, schema: dict, real_name: str,
                       canonical_value: str) -> str | None:
    options = notion_write_module.select_options(schema, real_name)
    for option in options:
        if canonical_profile_value(field, option) == canonical_value:
            return option
    return None


def _crm_to_notion_payload(
    field: str, crm_value: Any, schema: dict, real_name: str, prop_type: str
) -> dict[str, Any] | None:
    """Map only reviewed profile values to compatible live Notion property types."""
    expected_types = {
        "full_name": {"title"},
        "phone": {"phone_number", "rich_text"},
        "degree_level": {"select", "status"},
        "intake_year": {"select", "status"},
        "pipeline_status": {"select", "status"},
        **{key: {"number"} for key in MONEY_FIELDS},
        **{key: {"date"} for key in DATE_FIELDS},
    }
    if prop_type not in expected_types[field]:
        return None
    canonical = canonical_profile_value(field, crm_value)
    if canonical is None:
        return None
    notion_value = crm_value
    if field == "pipeline_status" and canonical == "no_status":
        return notion_write.build_property(prop_type, None)
    if field in ("degree_level", "intake_year", "pipeline_status"):
        notion_value = _select_option_for(field, notion_write, schema, real_name, canonical)
        if notion_value is None and field == "intake_year" and prop_type == "select":
            notion_value = canonical
        if notion_value is None:
            return None
    if field in MONEY_FIELDS:
        notion_value = float(canonical)
        if canonical_profile_value(field, notion_value) != canonical:
            return None
    if field in DATE_FIELDS:
        notion_value = canonical
    return notion_write.build_property(prop_type, notion_value)


def _notion_to_crm_value(field: str, notion_value: Any) -> Any | None:
    """Map a reviewed live Notion value into the CRM model's storage type."""
    if canonical_profile_value(field, notion_value) is None:
        return None
    if field == "full_name":
        return str(notion_value).strip()[:500]
    if field == "phone":
        return canonical_profile_value(field, notion_value)
    if field == "degree_level":
        from migration.transformers.normalize import parse_degree_or_none
        parsed = parse_degree_or_none(str(notion_value))
        if parsed not in {choice.value for choice in DegreeLevel}:
            return None
        return DegreeLevel(parsed)
    if field == "pipeline_status":
        return PipelineStatus(canonical_profile_value(field, notion_value))
    if field == "intake_year":
        parsed_year = _parse_intake(notion_value)
        return int(parsed_year) if parsed_year else None
    if field in MONEY_FIELDS:
        return Decimal(canonical_profile_value(field, notion_value))
    if field in DATE_FIELDS:
        return date.fromisoformat(canonical_profile_value(field, notion_value))
    return None


async def process_profile_field(
    session: AsyncSession,
    item: NotionFieldSync,
    *,
    student: Any,
    snapshot: Any,
    contract: Any = None,
    dry_run: bool = True,
) -> RuntimeResult:
    """Validate live values then optionally apply one supported profile field.

    The executor does not commit or advance the outbox state. Return values
    ``conflict``/``superseded`` let the worker preserve the row for review or
    reclassification. API/network errors are allowed to raise so the worker can
    record a retry through ``finish_attempt``.
    """
    field = item.field_key
    if field not in _FIELD_PROPERTY:
        return RuntimeResult(RuntimeDisposition.unsupported, field, "Field is outside the first safe profile-field allowlist")
    if item.direction not in (FieldSyncDirection.crm_to_notion, FieldSyncDirection.notion_to_crm):
        return RuntimeResult(RuntimeDisposition.conflict, field, "Outbox item has no safe write direction")
    if student is None or getattr(student, "is_archived", False):
        return RuntimeResult(RuntimeDisposition.superseded, field, "Linked CRM student changed or is missing")
    if (
        snapshot is None
        or snapshot.notion_page_id != item.notion_page_id
        or snapshot.status is not NotionMatchStatus.linked
        or snapshot.student_id != student.id
    ):
        return RuntimeResult(RuntimeDisposition.superseded, field, "Linked Notion page changed or is missing")
    if item.student_id != student.id:
        return RuntimeResult(RuntimeDisposition.superseded, field, "Linked CRM student changed or is missing")

    if field in CONTRACT_FIELD_ATTR and field != "pipeline_status" and contract is None:
        return RuntimeResult(RuntimeDisposition.conflict, field, SINGLE_CONTRACT_REQUIRED)
    if field in MONEY_FIELDS and getattr(contract, "currency", None) != "KZT":
        return RuntimeResult(RuntimeDisposition.conflict, field, KZT_CONTRACT_REQUIRED)
    expected_contract = getattr(item, "expected_contract_id", None)
    if expected_contract is not None and (contract is None or contract.id != expected_contract):
        return RuntimeResult(RuntimeDisposition.superseded, field, "The reviewed contract was replaced or removed")
    current_crm = _crm_raw(field, student, contract)
    if not _matches_expected(field, current_crm, item.crm_value):
        return RuntimeResult(RuntimeDisposition.superseded, field, "CRM field changed after this item was queued")

    expected_notion = canonical_profile_value(field, item.notion_value)
    if (expected_notion is None or (field == "pipeline_status" and expected_notion == "no_status")) and item.direction is FieldSyncDirection.notion_to_crm:
        return RuntimeResult(RuntimeDisposition.conflict, field, "Empty/invalid Notion values are not auto-applied")

    # Read the actual linked page property, not the potentially stale local mirror.
    def read_live_notion() -> tuple[dict[str, dict], str, str, Any]:
        schema = notion_write.get_schema()
        resolved = _resolve_notion_property(
            field,
            schema,
            require_writable=item.direction is FieldSyncDirection.crm_to_notion,
        )
        if resolved is None:
            raise ValueError(f"Notion property for {field} is missing or not writable")
        real_name, prop_type = resolved
        actual = notion_write.read_value(item.notion_page_id, real_name)
        return schema, real_name, prop_type, actual

    try:
        schema, real_name, prop_type, current_notion_raw = await asyncio.to_thread(read_live_notion)
    except ValueError:
        return RuntimeResult(RuntimeDisposition.conflict, field, "Notion property is missing or not writable")
    current_notion = canonical_profile_value(field, current_notion_raw)
    if current_notion_raw not in (None, "") and current_notion is None:
        return RuntimeResult(RuntimeDisposition.conflict, field, "Live Notion value is not recognized; preserve it for review")
    if current_notion != expected_notion:
        # A previous attempt can have written Notion successfully and then
        # failed before committing the local baseline/outbox transition. On
        # retry, the live field already equals the queued CRM target. Treat
        # this as a verified idempotent completion, not a stale conflict.
        if (
            item.direction is FieldSyncDirection.crm_to_notion
            and current_notion is not None
            and current_notion == canonical_profile_value(field, current_crm)
        ):
            if not dry_run:
                normalized = dict(snapshot.normalized_data or {})
                normalized[_SNAPSHOT_VALUE_KEY[field]] = canonical_profile_value(field, current_notion_raw) if field == "phone" else current_notion_raw
                snapshot.normalized_data = normalized
                if field == "phone":
                    snapshot.raw_properties = {**(getattr(snapshot, "raw_properties", None) or {}), real_name: current_notion_raw}
                baseline = dict(snapshot.synced_baseline or {})
                baseline[field] = current_notion
                if field == "pipeline_status":
                    baseline.pop("_portal_status", None)
                baseline["_initialized_fields"] = sorted(set(baseline.get("_initialized_fields", [])) | {field})
                snapshot.synced_baseline = baseline
                return RuntimeResult(RuntimeDisposition.applied, field, "Live Notion already matches the queued CRM value")
            return RuntimeResult(RuntimeDisposition.ready, field, "Live Notion already matches the queued CRM value")
        return RuntimeResult(RuntimeDisposition.superseded, field, "Notion field changed after this item was queued")

    target_canonical = (
        canonical_profile_value(field, current_crm)
        if item.direction is FieldSyncDirection.crm_to_notion
        else expected_notion
    )
    if target_canonical is None:
        return RuntimeResult(RuntimeDisposition.conflict, field, "Empty/invalid target values are not auto-applied")
    if (field == "phone" and item.direction is FieldSyncDirection.crm_to_notion
            and (phone_requires_review(current_notion_raw) or phone_requires_review(current_crm))):
        return RuntimeResult(RuntimeDisposition.conflict, field, "Phone annotations or additional numbers must be preserved; review the target")
    payload = None
    new_crm = current_crm
    if item.direction is FieldSyncDirection.crm_to_notion:
        payload = _crm_to_notion_payload(field, current_crm, schema, real_name, prop_type)
        if payload is None:
            return RuntimeResult(RuntimeDisposition.conflict, field, "Notion property type/value has no safe mapper")
    else:
        new_crm = _notion_to_crm_value(field, current_notion_raw)
        if new_crm is None:
            return RuntimeResult(RuntimeDisposition.conflict, field, "Live Notion value cannot be mapped to CRM")
    if dry_run:
        return RuntimeResult(RuntimeDisposition.ready, field, "Live versions match and the direction-specific mapper is valid")

    if item.direction is FieldSyncDirection.crm_to_notion:
        assert payload is not None
        await asyncio.to_thread(
            notion_write.update_page, item.notion_page_id, {real_name: payload}, True
        )
        verified_raw = await asyncio.to_thread(notion_write.read_value, item.notion_page_id, real_name)
        if canonical_profile_value(field, verified_raw) != target_canonical:
            raise RuntimeError(f"Notion read-after-write verification failed for {field}")
        actual_notion_after = verified_raw
        await log_change(session, "notion_snapshot", snapshot.id, f"notion_write:{field}",
                         current_notion_raw, verified_raw, "system:notion_field_sync", "notion_sync")
        old_crm = current_crm
        new_crm = current_crm
    else:
        target_raw = current_notion_raw
        if field == "full_name":
            new_crm = str(target_raw).strip()[:500]
        old_crm = current_crm
        if field == "pipeline_status":
            if contract is None:
                contract = Contract(student_id=student.id, pipeline_status=new_crm)
                session.add(contract)
                await session.flush()
            else:
                contract.pipeline_status = new_crm
        elif field in CONTRACT_FIELD_ATTR:
            setattr(contract, CONTRACT_FIELD_ATTR[field], new_crm)
        else:
            setattr(student, field, new_crm)
        student.updated_at = datetime.now(timezone.utc)
        await log_change(
            session,
            "contract" if field in CONTRACT_FIELD_ATTR else "student",
            contract.id if field in CONTRACT_FIELD_ATTR else student.id,
            CONTRACT_FIELD_ATTR[field] if field in CONTRACT_FIELD_ATTR else f"notion_auto_sync:{field}",
            old_crm.value if isinstance(old_crm, Enum) else old_crm,
            new_crm.value if isinstance(new_crm, Enum) else new_crm,
            "system:notion_field_sync",
            "notion_sync",
        )
        await session.flush()
        actual_notion_after = current_notion_raw

    # Only after read/write/readback (or the staged CRM update + flush) agree do
    # we advance the local mirror and common baseline. The transaction owner can
    # atomically commit the DB state and successful outbox transition.
    if not _matches_expected(field, new_crm, target_canonical):
        raise RuntimeError(f"CRM value failed post-write verification for {field}")
    if canonical_profile_value(field, actual_notion_after) != target_canonical:
        raise RuntimeError(f"Notion value failed post-write verification for {field}")

    normalized = dict(snapshot.normalized_data or {})
    normalized[_SNAPSHOT_VALUE_KEY[field]] = canonical_profile_value(field, actual_notion_after) if field == "phone" else actual_notion_after
    snapshot.normalized_data = normalized
    if field == "phone":
        snapshot.raw_properties = {**(getattr(snapshot, "raw_properties", None) or {}), real_name: actual_notion_after}
    baseline = dict(snapshot.synced_baseline or {})
    baseline[field] = target_canonical
    if field == "pipeline_status":
        baseline.pop("_portal_status", None)
    baseline["_initialized_fields"] = sorted(set(baseline.get("_initialized_fields", [])) | {field})
    snapshot.synced_baseline = baseline
    return RuntimeResult(RuntimeDisposition.applied, field, "Both sides verified and the shared baseline advanced")


async def process_outbox_batch(
    session: AsyncSession,
    *,
    limit: int = 20,
    dry_run: bool = True,
) -> dict[str, int]:
    """Claim and process a bounded batch; the caller owns the session.

    Dry-run results are retained as ``dry_run`` rows and are eligible for a
    real attempt only after the explicit dry-run switch is turned off. This
    method never starts a Notion/Sheets sync itself and is inert while the
    field-sync feature flag is off.
    """
    from sqlalchemy import select

    from app.models.notion_snapshot import NotionSnapshot
    from app.models.student import Student
    from app.services.notion_field_sync_outbox import claim_next, finish_attempt

    counters = {key: 0 for key in ("claimed", "dry_run", "applied", "conflict", "superseded", "retry")}
    for _ in range(max(0, min(limit, 100))):
        item = await claim_next(session, include_dry_run=not dry_run)
        if item is None:
            break
        item_id = item.id
        claimed_attempt = getattr(item, "attempts", None)
        await session.commit()  # Commit the lease before making a network call.
        counters["claimed"] += 1
        item = await session.get(NotionFieldSync, item_id)
        if item is None:
            continue
        try:
            student = await session.get(Student, item.student_id, with_for_update=True, populate_existing=True) if item.student_id else None
            snapshot = await session.get(NotionSnapshot, item.notion_snapshot_id, with_for_update=True, populate_existing=True) if item.notion_snapshot_id else None
            item = await session.get(NotionFieldSync, item_id, with_for_update=True, populate_existing=True)
            if item is None or item.status is not FieldSyncStatus.processing or (claimed_attempt is not None and item.attempts != claimed_attempt):
                await session.commit()
                continue
            contract = None
            if getattr(item, "field_key", None) in CONTRACT_FIELD_ATTR and student is not None:
                contracts = (await session.execute(select(Contract).where(Contract.student_id == student.id)
                    .order_by(Contract.created_at.desc(), Contract.id.desc()).limit(2).with_for_update().execution_options(populate_existing=True))).scalars().all()
                if item.field_key == "pipeline_status" or len(contracts) == 1:
                    contract = contracts[0] if contracts else None
            if student is not None and snapshot is not None:
                linked_ids = (await session.execute(select(NotionSnapshot.id).where(
                    NotionSnapshot.student_id == student.id,
                    NotionSnapshot.status == NotionMatchStatus.linked,
                ))).scalars().all()
                if linked_ids != [snapshot.id]:
                    item.status = FieldSyncStatus.superseded
                    item.locked_until = None
                    item.last_error = "Several Notion pages are linked to the student; source must be reviewed"
                    item.updated_at = datetime.now(timezone.utc)
                    await session.commit()
                    counters["superseded"] += 1
                    continue
            phone = getattr(snapshot, "phone_normalized", None)
            if getattr(item, "field_key", None) == "phone" and phone and phone in await load_shared_phones(session):
                item.status = FieldSyncStatus.conflict
                item.locked_until = None
                item.last_error = SHARED_PHONE_REASON
                item.updated_at = datetime.now(timezone.utc)
                await session.commit()
                counters["conflict"] += 1
                continue
            result = await process_profile_field(
                session, item, student=student, snapshot=snapshot, contract=contract, dry_run=dry_run
            )
            if result.disposition is RuntimeDisposition.ready:
                item.status = FieldSyncStatus.dry_run
                item.locked_until = None
                item.last_error = result.detail
                item.updated_at = datetime.now(timezone.utc)
                counters["dry_run"] += 1
            elif result.disposition is RuntimeDisposition.applied:
                await finish_attempt(session, item, succeeded=True)
                counters["applied"] += 1
            elif result.disposition in (RuntimeDisposition.conflict, RuntimeDisposition.unsupported):
                item.status = FieldSyncStatus.conflict
                item.locked_until = None
                item.last_error = result.detail
                item.updated_at = datetime.now(timezone.utc)
                counters["conflict"] += 1
            elif result.disposition is RuntimeDisposition.superseded:
                item.status = FieldSyncStatus.superseded
                item.locked_until = None
                item.last_error = result.detail
                item.updated_at = datetime.now(timezone.utc)
                counters["superseded"] += 1
            await session.commit()
        except Exception as exc:
            await session.rollback()
            item = await session.get(NotionFieldSync, item_id)
            if item is not None and item.status is FieldSyncStatus.processing:
                await finish_attempt(session, item, succeeded=False, error=str(exc))
                await session.commit()
            counters["retry"] += 1
    return counters
