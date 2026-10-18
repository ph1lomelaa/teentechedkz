"""Production-shaped queue tests against a disposable PostgreSQL and fake Notion.

Use only TTE_NOTION_TEST_DATABASE=postgresql+asyncpg://...@127.0.0.1:55436/notion_test.
No real Notion API is used. The dedicated database is recreated by this test.
"""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone, date
from decimal import Decimal
from uuid import uuid4
from unittest.mock import patch

URL = os.environ.get("TTE_NOTION_TEST_DATABASE", "")
if "@127.0.0.1:55436/notion_test" not in URL and not (os.environ.get("CI") == "true" and "@127.0.0.1:5432/notion_test" in URL):
    raise SystemExit("Use the dedicated temporary notion_test database on 127.0.0.1:55436")
os.environ["DATABASE_URL"] = URL
os.environ["ENABLE_NOTION_FIELD_SYNC"] = "true"
os.environ["NOTION_FIELD_SYNC_DRY_RUN"] = "true"
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]

from sqlalchemy import select, text, func
from app.core.database import Base, engine, AsyncSessionLocal
import app.models
from app.models import Student, Contract, NotionSnapshot, NotionFieldSync
from app.models.student import DegreeLevel
from app.models.contract import PipelineStatus
from app.models.user import User, UserRole
from app.models.notion_snapshot import NotionMatchStatus
from app.models.notion_field_sync import FieldSyncStatus
from app.models.status_history import StatusHistory
from app.core.config import settings
from app.services import notion_sync, notion_field_sync_runtime as runtime
from app.services.notion_field_sync_report import build_report
from app.services.notion_field_sync_outbox import enqueue_reconciliation
from app.services.notion_field_sync_policy import ReconciliationResult, FieldDecision, FieldSide
from app.api.v1.endpoints import sync
from fastapi import HTTPException

SCHEMA = {name: {"type": "number" if field in runtime.MONEY_FIELDS else "date" if field in runtime.DATE_FIELDS else "title" if field == "full_name" else "phone_number" if field == "phone" else "select", "select": {"options": [{"name": "2026"}, {"name": "2027"}, {"name": "Masters"}, {"name": "Undergraduate"}, {"name": "Активная работа"}, {"name": "На визе"}]}}
          for field, name in runtime._FIELD_PROPERTY.items() if name is not None}
SCHEMA["Name"] = {"type": "title"}
live = {}
writes = []

def read(page, name):
    return live[page].get(name)


def write(page, properties, verify=True):
    assert verify
    writes.append((page, properties))
    for name, payload in properties.items():
        kind, value = next(iter(payload.items()))
        if kind in ("select", "status"):
            value = value["name"] if value else None
        elif kind in ("title", "rich_text"):
            value = "".join(item["text"]["content"] for item in value)
        elif kind == "date":
            value = value["start"] if value else None
        live[page][name] = value


async def recent():
    return {"at": datetime.now(timezone.utc).isoformat(), "ok": True, "error": None, "counters": {}}


async def bootstrap():
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE notion_field_sync_outbox DROP COLUMN expected_contract_id"))
    await engine.dispose()

asyncio.run(bootstrap())
for args in [("stamp", "118"), ("upgrade", "head")]:
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=ROOT / "backend", check=True)
print("PASS migration 118 -> 119", flush=True)


async def seed(db, *, manual=False):
    student = Student(full_name="Test Person", phone="+77001234567", degree_level=DegreeLevel.undergraduate, intake_year=2026)
    db.add(student)
    await db.flush()
    contract = Contract(student_id=student.id, currency="KZT", amount=Decimal("100"),
                        pipeline_status=PipelineStatus.active_work, client_remaining_date=date(2026, 9, 28))
    db.add(contract)
    await db.flush()
    snapshot = NotionSnapshot(notion_page_id=uuid4().hex, student_id=student.id, status=NotionMatchStatus.linked,
        raw_properties={}, normalized_data={"full_name": student.full_name, "phone": student.phone,
        "degree_raw": "Undergraduate", "intake_raw": "2026", "payment_status_raw": "Активная работа",
        "client_fee": 200, "client_remaining_date": "2026-07-17"}, synced_baseline={})
    db.add(snapshot)
    await db.flush()
    live[snapshot.notion_page_id] = {"Name": student.full_name, "Номер тел": student.phone,
        "Degree": "Undergraduate", "Intake": "2026", "Статус выплат": "Активная работа",
        "Client fee": 200, "Остаток клиента (дата)": "2026-07-17"}
    if manual:
        db.add(StatusHistory(entity_type="contract", entity_id=contract.id, field_changed="amount",
            new_value="100.00", changed_by=str(uuid4()), source="manual"))
    await db.commit()
    return student, contract, snapshot


async def main():
    async with AsyncSessionLocal() as db:
        student, contract, snapshot = await seed(db)
        admin = User(name="Sync Admin", email=f"{uuid4()}@example.test", hashed_password="unused", role=UserRole.admin)
        db.add(admin)
        await db.commit()
        before = dict(snapshot.synced_baseline)
        report = await build_report(db)
        assert snapshot.synced_baseline == before
        assert not (await db.execute(select(func.count()).select_from(NotionFieldSync))).scalar()
        fee = next(f for f in report["rows"][0]["fields"] if f["field_key"] == "client_fee")
        assert fee["eligible"] and fee["winner"] == "notion", fee
        assert report["fresh"]
        print("PASS read-only report and initial Notion priority", flush=True)
        try:
            await sync.apply_notion_field_report(sync.ApplyNotionFieldReportBody(revision="stale"), db, admin)
            raise AssertionError("Stale report accepted")
        except HTTPException as error:
            assert error.status_code == 409
            await db.rollback()
        # A fresh session avoids expired ORM attributes after the rollback.
    async with AsyncSessionLocal() as db:
        student = (await db.execute(select(Student))).scalars().first()
        contract = (await db.execute(select(Contract))).scalars().first()
        snapshot = (await db.execute(select(NotionSnapshot))).scalars().first()
        admin = (await db.execute(select(User))).scalars().first()
        report = await sync.notion_field_report(db, admin)
        result = await sync.apply_notion_field_report(sync.ApplyNotionFieldReportBody(revision=report["revision"]), db, admin)
        assert result["queued"] == 2, result
        c = await runtime.process_outbox_batch(db, limit=20, dry_run=True)
        assert c["dry_run"] == 2 and not writes
        await db.refresh(contract)
        assert contract.amount == Decimal("100")
        settings.NOTION_FIELD_SYNC_DRY_RUN = False
        c = await runtime.process_outbox_batch(db, limit=20, dry_run=False)
        assert c["applied"] == 2, c
        await db.refresh(contract)
        assert contract.amount == Decimal("200") and contract.client_remaining_date == date(2026, 7, 17)
        print("PASS dry-run promotion, both contract values, audit and baseline", flush=True)
        # New CRM edit immediately queues a verified reverse write.
        contract.amount = Decimal("300")
        await db.flush()
        result = await notion_sync.enqueue_crm_field_edits(db, student, {"client_fee": "200"}, contract_id=contract.id)
        await db.commit()
        assert result["queued"] == 1
        c = await runtime.process_outbox_batch(db, dry_run=False)
        assert c["applied"] == 1 and live[snapshot.notion_page_id]["Client fee"] == 300, c
        report = await build_report(db)
        assert report["ready"] == 0 and report["review"] == 0, report
        await notion_sync._reconcile_baselines(db, [snapshot])
        await db.commit()
        assert not (await db.execute(select(func.count()).select_from(NotionFieldSync).where(NotionFieldSync.status == FieldSyncStatus.pending))).scalar()
        print("PASS reverse write and repeated poll without new changes", flush=True)
        # Audited initial financial edit is never silently overwritten.
        s2, c2, n2 = await seed(db, manual=True)
        report = await build_report(db, student_id=s2.id)
        field = next(f for f in report["rows"][0]["fields"] if f["field_key"] == "client_fee")
        assert not field["eligible"] and field["decision"] == "unknown_baseline", field
        # Bulk source selection is still checked and queued, never immediate.
        result = await sync.apply_notion_field_report(sync.ApplyNotionFieldReportBody(revision=report["revision"], student_id=s2.id,
            choices=[sync.NotionFieldChoice(snapshot_id=n2.id, field_key="client_fee", side="crm")]), db, admin)
        assert result["queued"] == 1
        await notion_sync._reconcile_baselines(db, [n2])
        await db.commit()
        c = await runtime.process_outbox_batch(db, dry_run=False)
        assert c["applied"] >= 1 and live[n2.notion_page_id]["Client fee"] == 100, c
        print("PASS manual audit protection and bulk choice survives mirror polling", flush=True)
        # An already queued operation cannot write through a new duplicate link.
        c2.amount = Decimal("150")
        await db.flush()
        await notion_sync.enqueue_crm_field_edits(db, s2, {"client_fee": "100"}, contract_id=c2.id)
        duplicate = NotionSnapshot(notion_page_id=uuid4().hex, student_id=s2.id, status=NotionMatchStatus.linked,
            raw_properties={}, normalized_data=dict(n2.normalized_data), synced_baseline={})
        db.add(duplicate)
        await db.commit()
        report = await build_report(db, student_id=s2.id)
        assert report["duplicate_students"] == 1 and report["ready"] == 0
        count = len(writes)
        c = await runtime.process_outbox_batch(db, dry_run=False)
        assert c["superseded"] and len(writes) == count
        print("PASS duplicate link blocks report and existing queue", flush=True)
        # Live Notion edits after enqueue supersede the operation.
        contract.amount = Decimal("400")
        await db.flush()
        await notion_sync.enqueue_crm_field_edits(db, student, {"client_fee": "300"}, contract_id=contract.id)
        await db.commit()
        live[snapshot.notion_page_id]["Client fee"] = 999
        c = await runtime.process_outbox_batch(db, dry_run=False)
        assert c["superseded"] and live[snapshot.notion_page_id]["Client fee"] == 999
        print("PASS live field change is preserved", flush=True)
        # A queued financial operation cannot follow a replacement contract.
        await db.refresh(snapshot)
        snapshot.normalized_data = {**snapshot.normalized_data, "client_fee": 999}
        snapshot.synced_baseline = {**snapshot.synced_baseline, "client_fee": "999.00"}
        await db.flush()
        await notion_sync.enqueue_crm_field_edits(db, student, {"client_fee": "300"}, contract_id=contract.id)
        old_id = contract.id
        await db.delete(contract)
        replacement = Contract(student_id=student.id, amount=Decimal("400"), currency="KZT", pipeline_status=PipelineStatus.active_work)
        db.add(replacement)
        await db.commit()
        c = await runtime.process_outbox_batch(db, dry_run=False)
        assert replacement.id != old_id and c["superseded"] and live[snapshot.notion_page_id]["Client fee"] == 999
        print("PASS replacement contract identity guard", flush=True)
    await engine.dispose()

with patch.object(settings, "NOTION_API_KEY", "fake"), patch.object(settings, "NOTION_DATABASE_ID", "fake"), \
     patch.object(runtime.notion_write, "get_schema", lambda: SCHEMA), \
     patch.object(runtime.notion_write, "read_value", read), \
     patch.object(runtime.notion_write, "update_page", write), \
     patch.object(notion_sync, "last_run", recent):
    asyncio.run(main())
print("PASS all disposable database checks", flush=True)
