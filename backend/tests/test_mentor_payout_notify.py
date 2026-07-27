"""Текст уведомления о выплате ментору (_mentor_payout_message) — чистая логика."""
from decimal import Decimal

from app.services.payment_notifier import _mentor_payout_message


def test_accrual_changed_with_outstanding():
    title, body = _mentor_payout_message("Иван Иванов", Decimal("250000"), Decimal("158500"), "KZT", "accrual_changed")
    assert "обновлена сумма к выплате" in title
    assert "Осталось выплатить: 158500 KZT" in body
    assert "начислено 250000" in body


def test_payout_recorded_with_outstanding():
    title, body = _mentor_payout_message("Иван", Decimal("250000"), Decimal("50000"), "KZT", "payout_recorded")
    assert "записана выплата" in title
    assert "Осталось выплатить: 50000 KZT" in body


def test_fully_paid_closes():
    title, body = _mentor_payout_message("Иван", Decimal("250000"), Decimal("0"), "KZT", "payout_recorded")
    assert "закрыты" in title
    assert "Выплачено полностью (250000 KZT)" in body


def test_overpaid_also_closes():
    title, _ = _mentor_payout_message("Иван", Decimal("250000"), Decimal("-1000"), "KZT", "accrual_changed")
    assert "закрыты" in title
