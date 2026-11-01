"""График платежей клиента и журнал изменений денег из Notion.

График — то, чего не было ни в Notion, ни в CRM: у договора была одна «дата
остатка», и в день оплаты финансисту не на что было смотреть. Строка графика —
один ожидаемый платёж (сумма + срок). Статус не хранится, а считается из
привязанных платежей (`payments.schedule_item_id`): хранимый статус пришлось бы
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

from sqlalchemy import Date, DateTime, Enum as SAEnum, ForeignKey, Numeric, String, Text
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
    contract_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contracts.id", ondelete="CASCADE"), index=True)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    kind: Mapped[ScheduleKind] = mapped_column(SAEnum(ScheduleKind, name="schedule_kind"), default=ScheduleKind.main)
    # «2 из 3», «финал» — как платёж называют в разговоре с клиентом.
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(10), default="KZT")
    due_date: Mapped[date] = mapped_column(Date, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    contract: Mapped["Contract"] = relationship()
    student: Mapped["Student"] = relationship()


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
