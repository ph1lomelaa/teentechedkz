"""Демо-данные раздела «Финансы» для тестовой среды и приёмки (задания 6 и 13).

55 учеников с пометкой «[ТЕСТ] Фин»: договоры разных сумм и статусов, графики
(равными частями и «предоплата + после оффера»), оплаты (полные, частичные,
переплата), просрочки, офферы, расхождения с Notion, договоры без графика,
изменения сумм и дат «из Notion».

Только для локальных и тестовых баз: отказывается работать, если в имени базы
нет tte_seed или tte_finance_check_. Повторный запуск сначала убирает прежние
«[ТЕСТ] Фин» записи этого скрипта.

    cd backend && PYTHONPATH=.. DATABASE_URL=postgresql+asyncpg://.../tte_seed python scripts/seed_finance_demo.py
"""
from __future__ import annotations

import asyncio
import os
import random
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import delete, select

from app.core.database import AsyncSessionLocal
from app.models.application import Application, SubmissionStatus
from app.models.contract import Contract, PipelineStatus
from app.models.credential import UniversityCredential
from app.models.finance import PaymentScheduleItem
from app.models.payment import Payment, PaymentMethod, PaymentStatus, PaymentType
from app.models.student import DegreeLevel, Student
from app.models.user import User, UserRole
from app.services import finance_desk

PREFIX = "[ТЕСТ] Фин"
FIRST = ["Айгерим", "Дана", "Тимур", "Алихан", "Мадина", "Аружан", "Ерлан", "Камила", "Нурсултан", "Жания",
         "Даурен", "Аяна", "Санжар", "Томирис", "Арман", "Асем", "Бекзат", "Диана", "Ильяс", "Мирас"]
LAST = ["Абенова", "Сериков", "Жумабаева", "Касымов", "Нурланова", "Тулегенов", "Оспанова", "Ахметов",
        "Есенова", "Бекова", "Сагындыков", "Ибраева", "Мусин", "Каримова", "Жолдасов"]
UNIS = [("TU Delft", "Нидерланды"), ("TU München", "Германия"), ("Politecnico di Milano", "Италия"),
        ("KAIST", "Корея"), ("University of Toronto", "Канада"), ("Charles University", "Чехия")]


def _guard() -> None:
    url = os.environ.get("DATABASE_URL", "")
    if "tte_seed" not in url and "tte_finance_check_" not in url:
        raise SystemExit(f"Отказ: база не тестовая ({url!r}). Нужна tte_seed или tte_finance_check_*.")


async def main() -> None:
    _guard()
    rnd = random.Random(1411)
    today = date.today()
    async with AsyncSessionLocal() as db:
        old = (await db.execute(select(Student.id).where(Student.full_name.like(f"{PREFIX}%")))).scalars().all()
        if old:
            await db.execute(delete(Student).where(Student.id.in_(old)))
            await db.commit()
        mzks = (await db.execute(select(User).where(User.role == UserRole.mzk_manager, User.is_active.is_(True)))).scalars().all()
        fin = (await db.execute(select(User).where(User.role == UserRole.finance_manager))).scalars().first()
        mentor = (await db.execute(select(User).where(User.role == UserRole.mentor, User.is_active.is_(True)))).scalars().first()
        if not mzks or fin is None or mentor is None:
            raise SystemExit("Нужны пользователи МЗК, финансист и ментор (seed_demo).")

        stats = {"contracts": 0, "payments": 0, "offers": 0}
        for n in range(55):
            name = f"{PREFIX} {FIRST[n % len(FIRST)]} {LAST[(n * 7) % len(LAST)]} {n + 1}"
            st = Student(full_name=name, phone=f"+7701{n:07d}", degree_level=DegreeLevel.undergraduate,
                         intake_year=2026 + n % 2)
            db.add(st)
            await db.flush()
            amount = Decimal(rnd.choice([900_000, 1_200_000, 1_500_000, 1_800_000, 2_400_000, 3_000_000]))
            status = rnd.choices([PipelineStatus.active_work, PipelineStatus.on_visa, PipelineStatus.paused,
                                  PipelineStatus.completed_admitted, PipelineStatus.refund], [70, 10, 8, 8, 4])[0]
            contract = Contract(student_id=st.id, amount=amount, currency="KZT", pipeline_status=status,
                                mzk_manager_id=mzks[n % len(mzks)].id, signed_date=today - timedelta(days=60 + n * 3))
            db.add(contract)
            await db.flush()
            stats["contracts"] += 1

            scenario = n % 11
            paid_total = Decimal("0")
            if scenario in (0, 1, 2, 3, 4, 5, 6):
                # Три равных платежа, первый от 100 дней назад до 20 дней вперёд.
                start = today + timedelta(days=rnd.randint(-100, 20))
                part = (amount / 3).quantize(Decimal("1"))
                for i in range(3):
                    db.add(PaymentScheduleItem(contract_id=contract.id, student_id=st.id, amount=part if i < 2 else amount - part * 2,
                                               currency="KZT", due_date=start + timedelta(days=30 * i), label=f"{i + 1} из 3",
                                               created_by=fin.id))
            elif scenario in (7, 8):
                prepay = (amount * Decimal("0.6")).quantize(Decimal("1"))
                db.add(PaymentScheduleItem(contract_id=contract.id, student_id=st.id, amount=prepay, currency="KZT",
                                           due_date=today - timedelta(days=rnd.randint(30, 120)), label="Предоплата", created_by=fin.id))
                db.add(PaymentScheduleItem(contract_id=contract.id, student_id=st.id, amount=amount - prepay, currency="KZT",
                                           due_date=None, after_offer=True, label="Остаток после оффера", created_by=fin.id))
            await db.flush()

            # Оплаты: прошедшие строки оплачены полностью, частично или нет (просрочка).
            rows = await finance_desk.load_items(db, today=today, contract_id=contract.id)
            for row in rows:
                if row.item.due_date is None or row.item.due_date > today:
                    continue
                fate = rnd.choices(["full", "partial", "none"], [65, 15, 20])[0]
                if fate == "none":
                    continue
                pay = row.item.amount if fate == "full" else (row.item.amount / 2).quantize(Decimal("1"))
                p = Payment(contract_id=contract.id, type=PaymentType.client_payment, amount=pay, currency="KZT",
                            status=PaymentStatus.paid, paid_at=row.item.due_date + timedelta(days=rnd.randint(0, 3)) if row.item.due_date + timedelta(days=3) <= today else today,
                            recorded_by=fin.id, method=rnd.choice([PaymentMethod.kaspi, PaymentMethod.bank, PaymentMethod.cash]),
                            payer=rnd.choice(["student", "parent", "parent"]))
                db.add(p)
                await db.flush()
                plan = await finance_desk.plan_allocation(db, contract_id=contract.id, amount=pay, today=today, prefer=row.item.id)
                await finance_desk.apply_allocation(db, p, plan)
                paid_total += pay
                stats["payments"] += 1
            if scenario == 9:
                # Без графика: только остаток в Notion — задача «Расписать график».
                paid_total = (amount * Decimal("0.4")).quantize(Decimal("1"))

            # Остаток «в Notion»: обычно сумма минус оплаты; у каждого шестого менеджер не обновил.
            remaining = amount - paid_total
            if n % 6 == 0 and paid_total > 0:
                remaining += Decimal(rnd.choice([100_000, 200_000, 300_000]))
            if status is PipelineStatus.completed_admitted:
                remaining = Decimal("0")
            contract.client_remaining_amount = min(remaining, amount)
            contract.client_remaining_date = today + timedelta(days=rnd.randint(-20, 60)) if remaining > 0 else None

            # Офферы: у договоров «предоплата + после оффера» и у каждого восьмого.
            if scenario in (7, 8) or n % 8 == 0:
                uni, country = UNIS[n % len(UNIS)]
                app = Application(student_id=st.id, contract_id=contract.id, university=uni, country=country,
                                  submission_status=SubmissionStatus.submitted)
                db.add(app)
                await db.flush()
                db.add(UniversityCredential(student_id=st.id, application_id=app.id, portal_name=f"{uni} portal",
                                            login_enc="demo", password_enc="demo"))
                await db.flush()
                if scenario == 7 or n % 8 == 0:
                    app.submission_status = SubmissionStatus.offer_received
                    await finance_desk.record_offer(db, app, actor=mentor, old_status=SubmissionStatus.submitted)
                    stats["offers"] += 1

            # Изменения «из Notion» для «Проверки».
            if n % 9 == 4:
                await finance_desk.record_notion_change(db, student=st, contract=contract, field="client_fee",
                                                        old=amount - 100_000, new=amount, source_ref=f"demo:{st.id}:fee")
            if n % 9 == 5 and contract.client_remaining_date:
                await finance_desk.record_notion_change(db, student=st, contract=contract, field="client_remaining_date",
                                                        old=(contract.client_remaining_date - timedelta(days=14)).isoformat(),
                                                        new=contract.client_remaining_date.isoformat(), source_ref=f"demo:{st.id}:date")
        await db.commit()

    # Колокольчик — как фоновый обработчик; писем не шлём (в тестовой среде их нет).
    async with AsyncSessionLocal() as db:
        await finance_desk.flush_notifications(db)
    async with AsyncSessionLocal() as db:
        from sqlalchemy import update

        from app.models.finance import FinanceChangeEvent
        await db.execute(update(FinanceChangeEvent).where(FinanceChangeEvent.emailed_at.is_(None))
                         .values(emailed_at=datetime.now(timezone.utc)))
        await db.commit()
    print(f"Готово: договоров {stats['contracts']}, оплат {stats['payments']}, офферов {stats['offers']}")


if __name__ == "__main__":
    asyncio.run(main())
