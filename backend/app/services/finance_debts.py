"""Сбор долгов (задание 8 плана 14.11.2026).

Долг — просроченная строка графика. По нему видно, кто с ним работает, что
уже сделано и что дальше. Регламент (сроки — в настройках):
  1 день просрочки  → МЗК получает напоминание (автоматически);
  7 дней без ответа МЗК → сигнал финансисту;
  30 дней → долг ведёт финансист;
  60 дней → колокольчик руководителю (админам).
Обещание оплатить приостанавливает эскалацию до обещанной даты; нарушенное
обещание возвращает долг на «Платежи» с меткой. Клиенту ничего не уходит.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.contract import Contract
from app.models.finance import DebtAction, PaymentScheduleItem
from app.models.student import Student
from app.models.user import User, UserRole
from app.services import finance_desk
from app.services.notify import notify, was_sent

KIND_LABELS = {
    "contact": "Контакт с клиентом",
    "promise": "Обещали оплатить",
    "reminder": "Напомнили МЗК",
    "mzk_reply": "Ответ МЗК",
    "escalated": "Передали руководителю",
    "reschedule": "Перенесли срок по согласованию",
    "promise_broken": "Обещание нарушено",
    "mzk_silent": "МЗК не ответил 7 дней",
    "head_alert": "Долг больше 60 дней — руководителю",
}
CHANNELS = {"call": "звонок", "message": "сообщение", "meeting": "встреча"}
MZK_ANSWERS = {"promised": "Связался, обещали оплатить", "no_answer": "Не дозвонился", "refund": "Клиент хочет вернуть деньги"}


def stage(days: int) -> str:
    if days <= settings.FINANCE_DEBT_FINANCE_DAYS:
        return "до 30 дней"
    if days <= settings.FINANCE_DEBT_HEAD_DAYS:
        return "31–60 дней"
    return "более 60 дней"


def responsible(days: int, escalated: bool) -> str:
    if escalated or days > settings.FINANCE_DEBT_HEAD_DAYS:
        return "Руководитель"
    if days > settings.FINANCE_DEBT_FINANCE_DAYS:
        return "Финансист"
    return "МЗК"


def action_text(a: DebtAction) -> str:
    parts = [KIND_LABELS.get(a.kind, a.kind)]
    if a.channel:
        parts.append(CHANNELS.get(a.channel, a.channel))
    if a.with_whom:
        parts.append(f"с кем: {a.with_whom}")
    if a.promise_date:
        parts.append(f"до {a.promise_date:%d.%m.%Y}" + (f" на {a.promise_amount:,.0f} ₸".replace(",", " ") if a.promise_amount else ""))
    if a.result:
        parts.append(a.result)
    return " · ".join(parts)


@dataclass
class DebtState:
    actions: list[DebtAction]
    promise: DebtAction | None  # последнее обещание, если его дата ещё не прошла
    broken: bool                # последнее обещание нарушено
    reminded_at: datetime | None
    replied_at: datetime | None
    escalated: bool


def state_of(actions: list[DebtAction], today: date) -> DebtState:
    actions = sorted(actions, key=lambda a: a.created_at)
    promises = [a for a in actions if a.kind == "promise" or (a.kind == "mzk_reply" and a.promise_date)]
    last_promise = promises[-1] if promises else None
    reminders = [a.created_at for a in actions if a.kind == "reminder"]
    replies = [a.created_at for a in actions if a.kind == "mzk_reply"]
    return DebtState(
        actions=actions,
        promise=last_promise if last_promise and last_promise.promise_date and last_promise.promise_date >= today else None,
        broken=bool(last_promise and last_promise.promise_date and last_promise.promise_date < today),
        reminded_at=max(reminders) if reminders else None,
        replied_at=max(replies) if replies else None,
        escalated=any(a.kind in ("escalated", "head_alert") for a in actions),
    )


async def actions_by_item(db: AsyncSession, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[DebtAction]]:
    if not item_ids:
        return {}
    out: dict[uuid.UUID, list[DebtAction]] = {}
    for a in (await db.execute(select(DebtAction).where(DebtAction.schedule_item_id.in_(item_ids))
                               .order_by(DebtAction.created_at))).scalars():
        out.setdefault(a.schedule_item_id, []).append(a)
    return out


async def add_action(db: AsyncSession, item: PaymentScheduleItem, kind: str, actor: User | None, **fields) -> DebtAction:
    action = DebtAction(schedule_item_id=item.id, contract_id=item.contract_id, kind=kind,
                        actor_id=actor.id if actor else None, **fields)
    db.add(action)
    await db.flush()
    return action


async def remind_mzk(db: AsyncSession, item: PaymentScheduleItem, actor: User | None, today: date) -> bool:
    """Колокольчик МЗК с просьбой связаться и ответить (кнопки на «Долгах»).
    Не чаще раза в день. Без commit. False — МЗК нет или уже напоминали."""
    contract = await db.get(Contract, item.contract_id)
    student = await db.get(Student, item.student_id)
    if contract is None or contract.mzk_manager_id is None or item.due_date is None:
        return False
    marker = f"[schedule:{item.id}:{today.isoformat()}]"
    if await was_sent(db, contract.mzk_manager_id, kind="payment_overdue", body_contains=marker):
        return False
    days = (today - item.due_date).days
    text = f"Платёж {item.amount:,.0f} ₸ со сроком {item.due_date:%d.%m.%Y}".replace(",", " ")
    if days > 0:
        text += f" просрочен на {days} дн."
    notify(db, contract.mzk_manager_id, kind="payment_overdue",
           title=f"Долг: {student.full_name if student else 'ученик'} — свяжитесь с клиентом",
           body=f"{text} Ответьте на «Долгах»: обещали оплатить, не дозвонились или клиент хочет вернуть деньги. {marker}",
           link=f"/finance/debts?item={item.id}", priority="high")
    await add_action(db, item, "reminder", actor)
    return True


async def escalate(db: AsyncSession, today: date) -> int:
    """Ежедневный проход по просрочке (регламент). Без commit."""
    rows = [r for r in await finance_desk.load_items(db, today=today, where=[PaymentScheduleItem.due_date < today])
            if r.state is finance_desk.ItemState.overdue]
    if not rows:
        return 0
    acts = await actions_by_item(db, [r.item.id for r in rows])
    recipients = await finance_desk.finance_recipients(db)
    admins = (await db.execute(select(User).where(User.role == UserRole.admin, User.is_active.is_(True)))).scalars().all()
    done = 0
    for r in rows:
        item = r.item
        days = (today - item.due_date).days
        st = state_of(acts.get(item.id, []), today)
        if st.promise is not None:
            continue  # обещание приостанавливает эскалацию до обещанной даты
        kinds = {a.kind for a in st.actions}
        if st.broken and not any(a.kind == "promise_broken" and a.created_at > max(
                (p.created_at for p in st.actions if p.kind in ("promise", "mzk_reply")), default=a.created_at) for a in st.actions):
            await add_action(db, item, "promise_broken", None)
            for u in recipients:
                notify(db, u.id, kind="finance_debt", title=f"{r.student_name}: обещание оплатить нарушено",
                       body=f"Платёж {item.amount:,.0f} ₸ всё ещё не оплачен.".replace(",", " "),
                       link=f"/finance/contracts/{item.contract_id}", priority="high")
            done += 1
            continue
        if days >= settings.FINANCE_DEBT_REMIND_DAYS and "reminder" not in kinds:
            if await remind_mzk(db, item, None, today):
                done += 1
        silent_after = st.reminded_at and (st.replied_at is None or st.replied_at < st.reminded_at)
        if silent_after and (datetime.now(timezone.utc) - st.reminded_at).days >= settings.FINANCE_DEBT_MZK_SILENT_DAYS \
                and not any(a.kind == "mzk_silent" and a.created_at > st.reminded_at for a in st.actions):
            await add_action(db, item, "mzk_silent", None)
            for u in recipients:
                notify(db, u.id, kind="finance_debt", title=f"{r.student_name}: МЗК не ответил по долгу",
                       body=f"Напоминание было {st.reminded_at:%d.%m.%Y}, ответа нет.", link=f"/finance/debts?item={item.id}",
                       priority="normal")
            done += 1
        if days > settings.FINANCE_DEBT_HEAD_DAYS and "head_alert" not in kinds:
            await add_action(db, item, "head_alert", None)
            for u in admins:
                notify(db, u.id, kind="finance_debt", title=f"{r.student_name}: долг больше {settings.FINANCE_DEBT_HEAD_DAYS} дней",
                       body=f"{item.amount - r.paid:,.0f} ₸, просрочка {days} дн. Решите: пауза услуг, новый график или расторжение.".replace(",", " "),
                       link=f"/finance/debts?item={item.id}", priority="high")
            done += 1
    return done


async def run_daily(db: AsyncSession) -> int:
    """Раз в день (первый проход после 10:00 Алматы) — эскалация по долгам.
    В режиме «только просмотр» (решение 15.11) не работает: графика нет."""
    if settings.FINANCE_VIEW_ONLY:
        return 0
    from zoneinfo import ZoneInfo
    now = datetime.now(ZoneInfo("Asia/Almaty"))
    if now.hour < 10:
        return 0
    from app.models.background_job import BackgroundJob
    stamp = f"debts:{now.date().isoformat()}"
    if (await db.execute(select(BackgroundJob.id).where(BackgroundJob.kind == "finance_debts",
                                                         BackgroundJob.request["stamp"].astext == stamp))).first():
        return 0
    db.add(BackgroundJob(kind="finance_debts", status="done", request={"stamp": stamp},
                         finished_at=datetime.now(timezone.utc)))
    return await escalate(db, now.date())


def amount_text(v: Decimal | None) -> str:
    return f"{v:,.0f} ₸".replace(",", " ") if v is not None else "—"
