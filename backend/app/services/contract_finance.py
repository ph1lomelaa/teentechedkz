"""Финансовые величины договора, вычисляемые в самом CRM (не зеркалимые из Notion).

CRM — источник правды: остаток клиента и «осталось доплатить» (TBP) считаем из
контракта и фактических платежей (app.models.payment.Payment), а значения тех же
величин из Notion показываем рядом только для сверки (см. эндпоинт finance-summary).

Функции — чистые (Decimal/None на входе и выходе, без обращений к БД), чтобы их
можно было прогонять в юнит-тестах без сети и без базы. Агрегаты платежей
(client_paid, mentor_paid) вычисляет вызывающий код теми же правилами, что уже
приняты в endpoints/payments.py:
  client_paid = sum(Payment.amount) where type=client_payment, status=paid
  mentor_paid = sum(Payment.amount) where type=mentor_payout,  status=paid
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def _dec(v: Any) -> Decimal | None:
    """Любое значение → Decimal или None. Пустые/непарсящиеся → None (не 0!):
    отсутствие данных и подтверждённый ноль — разные вещи для финансов."""
    if v is None or v == "":
        return None
    if isinstance(v, Decimal):
        return v
    try:
        return Decimal(str(v).replace(" ", "").replace(",", "."))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _diff(total: Any, paid: Any) -> Decimal | None:
    """Остаток = сколько ещё должно быть = total − paid. None, если total неизвестен.
    paid трактуем как 0, когда платежей нет (это подтверждённое «не платили»)."""
    t = _dec(total)
    if t is None:
        return None
    p = _dec(paid) or Decimal("0")
    return t - p


def english_tbp(english_sum: Any, english_paid: Any) -> Decimal | None:
    """Осталось доплатить за английский = Сумм Англ − PAID Англ."""
    return _diff(english_sum, english_paid)


def mentor_tbp(mentor_total_owed: Any, mentor_paid: Any) -> Decimal | None:
    """Осталось выплатить менторам = TOTAL (Mentors) − сумма фактических выплат."""
    return _diff(mentor_total_owed, mentor_paid)


def client_remaining(amount: Any, client_paid: Any, manual_remaining: Any = None) -> Decimal | None:
    """Остаток клиента. Приоритет — ручное значение (колонка «Остаток клиента»,
    если менеджер его подтвердил); иначе считаем из договора: Client fee − оплачено.
    None только когда нет ни ручного остатка, ни суммы договора."""
    manual = _dec(manual_remaining)
    if manual is not None:
        return manual
    return _diff(amount, client_paid)


def tbp_total(*parts: Any) -> Decimal | None:
    """Суммарно «осталось доплатить» по переданным TBP-частям (english/mentor/up/…).
    None, если ни одна часть не известна; известные None-части считаются 0."""
    known = [_dec(p) for p in parts]
    if all(k is None for k in known):
        return None
    return sum((k for k in known if k is not None), Decimal("0"))
