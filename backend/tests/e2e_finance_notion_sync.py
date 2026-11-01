"""Сквозная проверка «правка денег в Notion → бухгалтер узнаёт сразу».

Настоящий Notion не трогается: подменены только сетевые функции чтения и
записи (fetch_all_pages, notion_write). Всё остальное — настоящий код синка.

    FINANCE_TEST_DATABASE_URL=postgresql+asyncpg://...@127.0.0.1:5432/tte_finance_check_sync \
        python tests/e2e_finance_notion_sync.py

База — одноразовая, подготовленная `python -m app.core.bootstrap_db`.
"""
import asyncio
import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

URL = os.environ.get("FINANCE_TEST_DATABASE_URL", "")
if "/tte_finance_check_" not in URL:
    raise SystemExit("Нужна одноразовая база: FINANCE_TEST_DATABASE_URL=...tte_finance_check_*")
os.environ["DATABASE_URL"] = URL
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]

from sqlalchemy import func, select  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import AsyncSessionLocal  # noqa: E402
from app.models import Contract, NotionSnapshot, Student  # noqa: E402
from app.models.contract import PipelineStatus  # noqa: E402
from app.models.finance import FinanceChangeEvent, PaymentScheduleItem  # noqa: E402
from app.models.notification import Notification  # noqa: E402
from app.models.notion_snapshot import NotionMatchStatus  # noqa: E402
from app.models.payment import Payment, PaymentMethod, PaymentStatus, PaymentType  # noqa: E402
from app.models.student import DegreeLevel  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.services import finance_desk, mailer, notion_sync, notion_field_sync_runtime as runtime  # noqa: E402

settings.ENABLE_NOTION_FIELD_SYNC = True
settings.NOTION_FIELD_SYNC_DRY_RUN = False
settings.NOTION_API_KEY = settings.NOTION_API_KEY or "test"
settings.NOTION_DATABASE_ID = settings.NOTION_DATABASE_ID or "test"
settings.FINANCE_EMAIL_NOTIFICATIONS = True

PAGE = uuid4().hex
P = runtime._FIELD_PROPERTY
SCHEMA = {
    name: {"type": "number" if f in runtime.MONEY_FIELDS else "date" if f in runtime.DATE_FIELDS
           else "title" if f == "full_name" else "phone_number" if f == "phone" else "select",
           "select": {"options": [{"name": "2027"}, {"name": "Undergraduate"}, {"name": "Активная работа"}]}}
    for f, name in P.items() if name is not None
}
live: dict = {}
letters: list = []
filters: list = []
NAME = f"Сквозной Ученик {PAGE[:6]}"


async def fake_send_mail(*, to, subject, text, html=None):
    letters.append((to, subject, text))


def state(remaining, due, up_paid, edited):
    row = {"notion_page_id": PAGE, "notion_url": "https://notion.so/x", "full_name": NAME,
           "phone": "+77005550001", "degree_raw": "Undergraduate", "intake_raw": "2027",
           "payment_status_raw": "Активная работа", "client_fee": 1350000,
           "client_remaining": remaining, "client_remaining_date": due, "up_paid": up_paid,
           "last_edited_time": edited, "raw_properties": {}}
    live.clear()
    live.update({P["full_name"]: NAME, P["phone"]: row["phone"], P["degree_level"]: "Undergraduate",
                 P["intake_year"]: "2027", P["pipeline_status"]: "Активная работа", P["client_fee"]: 1350000,
                 P["client_remaining"]: remaining, P["client_remaining_date"]: due})
    return row


def write(page, props, verify=True):
    for name, payload in props.items():
        kind, value = next(iter(payload.items()))
        live[name] = value["start"] if kind == "date" and value else value


async def sync_once(row):
    def fetch(*args, edited_since=None, **kwargs):
        filters.append(edited_since)
        return []

    with patch("migration.sources.notion.fetch_all_pages", fetch), \
         patch("migration.sources.notion.transform_notion_records", lambda pages: [dict(row)]), \
         patch.object(runtime.notion_write, "get_schema", lambda: SCHEMA), \
         patch.object(runtime.notion_write, "read_value", lambda page, name: live.get(name)), \
         patch.object(runtime.notion_write, "update_page", write), \
         patch.object(mailer, "is_configured", lambda: True), \
         patch.object(mailer, "send_mail", fake_send_mail):
        async with AsyncSessionLocal() as db:
            await notion_sync.run_sync(db, quick=True)
        # То, что делает finance_notify_loop и field_sync_loop.
        async with AsyncSessionLocal() as db:
            await runtime.process_outbox_batch(db, limit=50, dry_run=False)
            await finance_desk.flush_notifications(db)
        async with AsyncSessionLocal() as db:
            await finance_desk.email_pending(db)


async def counts(student_id, user_id):
    async with AsyncSessionLocal() as db:
        events = (await db.execute(select(FinanceChangeEvent).where(FinanceChangeEvent.student_id == student_id)
                                   .order_by(FinanceChangeEvent.field))).scalars().all()
        notes = (await db.execute(select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id, Notification.kind == "finance_change"))).scalar()
    return events, notes


async def main():
    async with AsyncSessionLocal() as db:
        for old in (await db.execute(select(User).where(User.role == UserRole.finance_manager))).scalars():
            old.is_active = False
        fin = User(name="Бухгалтер", email=f"{PAGE[:6]}@fin.test", hashed_password="x",
                   role=UserRole.finance_manager, is_active=True)
        st = Student(full_name=NAME, phone="+77005550001", degree_level=DegreeLevel.undergraduate, intake_year=2027)
        db.add_all([fin, st])
        await db.flush()
        db.add(Contract(student_id=st.id, amount=Decimal("1350000"), currency="KZT",
                        pipeline_status=PipelineStatus.active_work,
                        client_remaining_amount=Decimal("800000"), client_remaining_date=date(2026, 11, 30)))
        db.add(NotionSnapshot(notion_page_id=PAGE, student_id=st.id, status=NotionMatchStatus.linked,
                              raw_properties={}, normalized_data={}, synced_baseline={}))
        await db.commit()
        fin_id, st_id = fin.id, st.id
    t0 = datetime(2026, 11, 1, 8, tzinfo=timezone.utc)

    await sync_once(state(800000, "2026-11-30", 0, t0.isoformat()))
    events, notes = await counts(st_id, fin_id)
    assert not events and notes == 0, "первый проход — только исходное состояние"

    # МЗК поменяла в Notion остаток, дату оплаты и оплату УП.
    await sync_once(state(900000, "2026-12-05", 25000, (t0 + timedelta(hours=1)).isoformat()))
    assert filters[-1] is not None, "второй проход — быстрый, только изменённые страницы"
    events, notes = await counts(st_id, fin_id)
    assert sorted(e.field for e in events) == ["client_remaining", "client_remaining_date", "up_paid"], events
    assert notes == 1, "одно уведомление на договор"
    assert len(letters) == 1 and letters[0][0] == [f"{PAGE[:6]}@fin.test"], letters
    print("PASS правка в Notion → журнал, одно уведомление, одно письмо")

    # Вторая правка в ту же минуту: время правки в Notion не изменилось.
    await sync_once(state(950000, "2026-12-05", 25000, (t0 + timedelta(hours=1)).isoformat()))
    async with AsyncSessionLocal() as db:
        contract = (await db.execute(select(Contract).where(Contract.student_id == st_id))).scalar_one()
        assert contract.client_remaining_amount == Decimal("950000"), contract.client_remaining_amount
    print("PASS вторая правка в ту же минуту не потерялась")

    # Проход без изменений — ничего нового.
    async def snapshot_counts():
        events, notes = await counts(st_id, fin_id)
        return [(e.field, e.old_value, e.new_value) for e in events], notes, len(letters)
    before = await snapshot_counts()
    await sync_once(state(950000, "2026-12-05", 25000, (t0 + timedelta(hours=1)).isoformat()))
    assert await snapshot_counts() == before
    print("PASS без изменений — ни записей, ни уведомлений, ни писем")

    # Оплата в платформе уходит в Notion и не приходит бухгалтеру уведомлением.
    async with AsyncSessionLocal() as db:
        contract = (await db.execute(select(Contract).where(Contract.student_id == st_id))).scalar_one()
        fin = await db.get(User, fin_id)
        a = PaymentScheduleItem(contract_id=contract.id, student_id=st_id, amount=Decimal("450000"),
                                due_date=date(2026, 12, 5), label="1 из 2")
        b = PaymentScheduleItem(contract_id=contract.id, student_id=st_id, amount=Decimal("500000"),
                                due_date=date(2027, 1, 10), label="2 из 2")
        db.add_all([a, b])
        await db.flush()
        db.add(Payment(contract_id=contract.id, type=PaymentType.client_payment, amount=Decimal("450000"),
                       status=PaymentStatus.paid, paid_at=date(2026, 11, 1), recorded_by=fin_id,
                       schedule_item_id=a.id, method=PaymentMethod.kaspi))
        await db.flush()
        await finance_desk.sync_contract_to_notion(db, contract, today=date(2026, 11, 1), user=fin,
                                                   paid_now=Decimal("450000"))
        await db.commit()
    with patch.object(runtime.notion_write, "get_schema", lambda: SCHEMA), \
         patch.object(runtime.notion_write, "read_value", lambda page, name: live.get(name)), \
         patch.object(runtime.notion_write, "update_page", write):
        async with AsyncSessionLocal() as db:
            await runtime.process_outbox_batch(db, limit=50, dry_run=False)
            await finance_desk.flush_notifications(db)
    assert live[P["client_remaining"]] == 500000 and live[P["client_remaining_date"]] == "2027-01-10", live
    assert (await counts(st_id, fin_id))[1] == before[1], "своя оплата не приходит уведомлением"
    print("PASS оплата в платформе ушла в Notion: остаток 500 000, дата 10.01.2027")
    print("ALL PASS")


asyncio.run(main())
