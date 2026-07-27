"""Расчёт финансов договора в CRM (contract_finance) — чистая логика, без БД/сети."""
from decimal import Decimal

from app.services import contract_finance as cf


# --- english_tbp / mentor_tbp -------------------------------------------------

def test_english_tbp_basic():
    assert cf.english_tbp(600000, 200000) == Decimal("400000")


def test_english_tbp_no_payment_is_full_sum():
    assert cf.english_tbp(600000, None) == Decimal("600000")


def test_english_tbp_unknown_sum_is_none():
    # Нет суммы договора → остаток неизвестен (не 0).
    assert cf.english_tbp(None, 100000) is None


def test_mentor_tbp_basic():
    assert cf.mentor_tbp(500000, 91500) == Decimal("408500")


def test_mentor_tbp_overpaid_goes_negative():
    # Переплату не прячем — отрицательный остаток виден как сигнал ошибки в данных.
    assert cf.mentor_tbp(100000, 150000) == Decimal("-50000")


# --- client_remaining ---------------------------------------------------------

def test_client_remaining_from_contract():
    # Ручной колонки нет → считаем Client fee − оплачено клиентом.
    assert cf.client_remaining(1000000, 400000) == Decimal("600000")


def test_client_remaining_manual_wins():
    # Менеджер подтвердил ручной остаток — он в приоритете над расчётом.
    assert cf.client_remaining(1000000, 400000, manual_remaining=250000) == Decimal("250000")


def test_client_remaining_manual_zero_is_confirmed_zero():
    # Ручной 0 — это подтверждённый ноль, а не «нет данных».
    assert cf.client_remaining(1000000, 0, manual_remaining=0) == Decimal("0")


def test_client_remaining_no_amount_no_manual_is_none():
    assert cf.client_remaining(None, 400000) is None


# --- нормализация «грязных» значений из Notion --------------------------------

def test_dec_parses_spaced_and_comma_numbers():
    # В Notion числа приходят строками с пробелами/запятой.
    assert cf.client_remaining("1 000 000", "400 000") == Decimal("600000")
    assert cf.english_tbp("600000,5", "0") == Decimal("600000.5")


def test_dec_empty_string_is_none_not_zero():
    assert cf.english_tbp("", "100") is None


# --- tbp_total ----------------------------------------------------------------

def test_tbp_total_sums_known_parts():
    assert cf.tbp_total(400000, 408500, None, 25000) == Decimal("833500")


def test_tbp_total_all_unknown_is_none():
    assert cf.tbp_total(None, None) is None
