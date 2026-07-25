"""Финансовые предупреждения профиля студента (_compute_student_alerts).

Логика чистая (только доступ к атрибутам), поэтому Contract/Payment подменяем
лёгкими фейками — без БД и ORM.
"""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from app.api.v1.endpoints.students import _compute_student_alerts
from app.models.payment import PaymentType, PaymentStatus

TODAY = date(2026, 7, 26)


def _pay(ptype, amount, status=PaymentStatus.paid):
    return SimpleNamespace(type=ptype, amount=Decimal(str(amount)), status=status)


def _contract(**kw):
    base = dict(
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        currency="KZT",
        amount=None,
        client_remaining_amount=None,
        client_remaining_date=None,
        mentor_total_owed=None,
        payments=[],
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_no_contracts_no_alerts():
    assert _compute_student_alerts([], TODAY) == []


def test_payment_due_soon_is_warning():
    c = _contract(amount=Decimal("1000000"), client_remaining_date=TODAY + timedelta(days=10),
                  payments=[_pay(PaymentType.client_payment, 400000)])
    alerts = _compute_student_alerts([c], TODAY)
    due = [a for a in alerts if a["kind"] == "payment_due"]
    assert len(due) == 1
    assert due[0]["level"] == "warning"
    assert due[0]["amount"] == 600000.0
    assert due[0]["days"] == 10


def test_payment_due_within_3_days_is_danger():
    c = _contract(amount=Decimal("1000000"), client_remaining_date=TODAY + timedelta(days=2),
                  payments=[_pay(PaymentType.client_payment, 400000)])
    due = [a for a in _compute_student_alerts([c], TODAY) if a["kind"] == "payment_due"]
    assert due and due[0]["level"] == "danger" and due[0]["days"] == 2


def test_overdue_payment_is_danger():
    c = _contract(amount=Decimal("500000"), client_remaining_date=TODAY - timedelta(days=5),
                  payments=[])
    over = [a for a in _compute_student_alerts([c], TODAY) if a["kind"] == "payment_overdue"]
    assert over and over[0]["level"] == "danger" and over[0]["amount"] == 500000.0


def test_no_alert_when_fully_paid():
    c = _contract(amount=Decimal("1000000"), client_remaining_date=TODAY + timedelta(days=5),
                  payments=[_pay(PaymentType.client_payment, 1000000)])
    assert [a for a in _compute_student_alerts([c], TODAY) if a["kind"].startswith("payment")] == []


def test_no_alert_beyond_look_ahead_window():
    c = _contract(amount=Decimal("1000000"), client_remaining_date=TODAY + timedelta(days=90),
                  payments=[])
    assert [a for a in _compute_student_alerts([c], TODAY) if a["kind"].startswith("payment")] == []


def test_mentor_unpaid_alert():
    c = _contract(mentor_total_owed=Decimal("500000"),
                  payments=[_pay(PaymentType.mentor_payout, 200000)])
    mu = [a for a in _compute_student_alerts([c], TODAY) if a["kind"] == "mentor_unpaid"]
    assert mu and mu[0]["level"] == "info" and mu[0]["amount"] == 300000.0


def test_latest_contract_wins():
    old = _contract(created_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
                    amount=Decimal("999"), client_remaining_date=TODAY - timedelta(days=1))
    new = _contract(created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
                    amount=Decimal("1000000"), client_remaining_date=TODAY + timedelta(days=5))
    alerts = _compute_student_alerts([old, new], TODAY)
    # берётся новый договор → предупреждение "через 5 дн.", а не просрочка старого
    assert any(a["kind"] == "payment_due" and a["days"] == 5 for a in alerts)
    assert not any(a["kind"] == "payment_overdue" for a in alerts)


def test_manual_remaining_overrides_computation():
    # Ручной остаток из Notion в приоритете над Client fee − оплачено.
    c = _contract(amount=Decimal("1000000"), client_remaining_amount=Decimal("250000"),
                  client_remaining_date=TODAY + timedelta(days=7),
                  payments=[_pay(PaymentType.client_payment, 100000)])
    due = [a for a in _compute_student_alerts([c], TODAY) if a["kind"] == "payment_due"]
    assert due and due[0]["amount"] == 250000.0
