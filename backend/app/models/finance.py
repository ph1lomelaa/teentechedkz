"""График платежей клиента и журнал изменений денег из Notion.

График — то, чего не было ни в Notion, ни в CRM: у договора была одна «дата
остатка», и в день оплаты финансисту не на что было смотреть. Строка графика —
один ожидаемый платёж (сумма + срок). Статус не хранится, а считается из
распределённых на строку оплат (`payment_allocations`): хранимый статус пришлось бы
синхронизировать с каждым внесением и правкой платежа.

Журнал изменений — след того, что МЗК поменял в пайплайне Notion деньги или
дату. Синк полей уже переносит значение в договор сам; событие нужно, чтобы
финансист узнал об этом и решил, двигать ли график.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, Enum as SAEnum, ForeignKey, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ScheduleKind(str, enum.Enum):
    main = "main"
    english = "english"
    portfolio = "portfolio"
    proforientation = "proforientation"
    ielts_fee = "ielts_fee"
    other = "other"


class PaymentScheduleItem(Base):
    __tablename__ = "payment_schedule_items"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    import_key: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[ScheduleKind] = mapped_column(SAEnum(ScheduleKind, name="schedule_kind"), default=ScheduleKind.main)
    # «2 из 3», «финал» — как платёж называют в разговоре с клиентом.
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(10), default="KZT")
    # Пусто у строки «после оффера», пока оффера нет: при отметке оффера срок
    # = дата оффера + FINANCE_AFTER_OFFER_DAYS (миграция 141).
    due_date: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    after_offer: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
    # Строка не удаляется, а отменяется с причиной (миграция 140): остаётся
    # в истории договора, но не входит в суммы, списки и календарь.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    contract: Mapped["Contract"] = relationship()
    student: Mapped["Student"] = relationship()


class PaymentAllocation(Base):
    """Сколько из оплаты закрыло строку графика (миграция 141). Одна оплата
    может закрыть несколько строк или часть строки; нераспределённая часть
    оплаты — аванс клиента. Считаются только оплаты со status == paid."""
    __tablename__ = "payment_allocations"
    __table_args__ = (
        UniqueConstraint("payment_id", "schedule_item_id", name="uq_payment_allocation"),
        CheckConstraint("amount > 0", name="ck_payment_allocation_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    payment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payments.id", ondelete="CASCADE"), index=True)
    schedule_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payment_schedule_items.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DebtAction(Base):
    """Действие по просроченному платежу (задание 8, миграция 144): контакт,
    обещание оплатить, напоминание МЗК и его ответ, передача руководителю,
    перенос срока, нарушенное обещание. Лента не редактируется и не удаляется."""
    __tablename__ = "debt_actions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    schedule_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payment_schedule_items.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    channel: Mapped[str | None] = mapped_column(String(20), nullable=True)
    with_whom: Mapped[str | None] = mapped_column(String(200), nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    promise_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    promise_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class FinanceClosedMonth(Base):
    """Закрытый месяц (миграция 146): оплаты за него меняет только админ с причиной."""
    __tablename__ = "finance_closed_months"

    month: Mapped[date] = mapped_column(Date, primary_key=True)  # первое число месяца
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class FinanceChangeStatus(str, enum.Enum):
    new = "new"
    accepted = "accepted"
    kept = "kept"


class FinanceChangeEvent(Base):
    __tablename__ = "finance_change_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    contract_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), nullable=True)
    # Ключ поля: как в синке полей (client_fee, client_remaining_date, …) или
    # в снимке Notion для полей, которых в синке нет (up_sum, mentor_paid, …).
    field: Mapped[str] = mapped_column(String(40))
    old_value: Mapped[str | None] = mapped_column(String(200), nullable=True)
    new_value: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # notion — правка пришла синком из Notion; platform — кто-то поменял деньги
    # в самой платформе (карточка договора, старый раздел оплат).
    source: Mapped[str] = mapped_column(String(20), default="notion")
    # Кто поменял — для правок в платформе и ручного применения значения из Notion.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Ключ происхождения: id элемента outbox синка полей или «снимок + время
    # правки + поле». Уникален — повторный прогон упавшей синхронизации не
    # создаёт вторую запись.
    source_ref: Mapped[str | None] = mapped_column(String(160), nullable=True, unique=True)
    # Когда ушло уведомление. Пусто — ещё не отправлено: следующий проход
    # синка его отправит, так что запись не теряется при сбое.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    # Legacy dispatch watermark: событие обработано очередью доставки.
    # Результат по каждому получателю хранится в finance_mail_deliveries.
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[FinanceChangeStatus] = mapped_column(
        SAEnum(FinanceChangeStatus, name="finance_change_status"), default=FinanceChangeStatus.new, index=True
    )
    # Строка графика, которую передвинули, когда изменение приняли.
    schedule_item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payment_schedule_items.id", ondelete="SET NULL"), nullable=True
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    student: Mapped["Student"] = relationship()
