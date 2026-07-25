"""Запись CRM → Notion (notion_write + подбор опций select).

Без сети: проверяем сборку payload'ов, резолв колонок по «капризным» именам
(хвостовые пробелы/регистр) и подбор существующей опции select под CRM-значение.
"""
from app.services import notion_write
from migration.transformers.normalize import parse_pipeline_status, parse_degree_or_none


# --- build_property: значение -> типизированный payload Notion ------------------

def test_build_property_number():
    assert notion_write.build_property("number", 600000.0) == {"number": 600000.0}


def test_build_property_phone():
    assert notion_write.build_property("phone_number", "+77001234567") == {"phone_number": "+77001234567"}


def test_build_property_date_trims_to_day():
    assert notion_write.build_property("date", "2025-09-01T00:00:00") == {"date": {"start": "2025-09-01"}}


def test_build_property_title_and_rich_text():
    assert notion_write.build_property("title", "Иван Иванов") == {
        "title": [{"type": "text", "text": {"content": "Иван Иванов"}}]
    }
    assert notion_write.build_property("rich_text", "Fall 2025") == {
        "rich_text": [{"type": "text", "text": {"content": "Fall 2025"}}]
    }


def test_build_property_select():
    assert notion_write.build_property("select", "Активная работа") == {"select": {"name": "Активная работа"}}


def test_build_property_none_clears():
    assert notion_write.build_property("rich_text", None) == {"rich_text": []}
    assert notion_write.build_property("select", None) == {"select": None}


def test_build_property_unwritable_type_raises():
    try:
        notion_write.build_property("formula", 123)
    except ValueError:
        return
    raise AssertionError("ожидали ValueError на неписываемый тип")


# --- resolve_property: колонки с хвостовыми пробелами/регистром -----------------

def _schema():
    return {
        "Client fee ": {"type": "number"},          # хвостовой пробел
        "Номер тел": {"type": "phone_number"},
        "Имя студента": {"type": "title"},
        "Статус выплат": {"type": "status", "status": {"options": [
            {"name": "Активная работа"}, {"name": "На возврате"}, {"name": "Без статуса"},
        ]}},
        "Degree": {"type": "select", "select": {"options": [
            {"name": "Бакалавриат"}, {"name": "Магистратура"},
        ]}},
        "TBP (Mentors)": {"type": "formula"},
    }


def test_resolve_property_ignores_trailing_space_and_case():
    name, ptype = notion_write.resolve_property(_schema(), "client fee")
    assert name == "Client fee " and ptype == "number"


def test_resolve_property_missing():
    assert notion_write.resolve_property(_schema(), "нет такой") == (None, None)


def test_find_title_property_by_type():
    name, ptype = notion_write.find_title_property(_schema())
    assert name == "Имя студента" and ptype == "title"


def test_formula_column_is_not_writable():
    _, ptype = notion_write.resolve_property(_schema(), "TBP (Mentors)")
    assert ptype not in notion_write.WRITABLE_TYPES


def test_select_options_extracted():
    assert notion_write.select_options(_schema(), "Статус выплат") == [
        "Активная работа", "На возврате", "Без статуса",
    ]


# --- подбор существующей опции select под CRM-значение (логика push_field) ------

def _match_option(options, crm_value, parser):
    return next((o for o in options if parser(o) == crm_value), None)


def test_pipeline_status_matches_existing_option():
    options = notion_write.select_options(_schema(), "Статус выплат")
    assert _match_option(options, "active_work", parse_pipeline_status) == "Активная работа"
    assert _match_option(options, "refund", parse_pipeline_status) == "На возврате"


def test_pipeline_status_no_matching_option_returns_none():
    # Опции "На визе" нет в схеме — записывать нечего (не плодим новую опцию).
    options = notion_write.select_options(_schema(), "Статус выплат")
    assert _match_option(options, "on_visa", parse_pipeline_status) is None


def test_degree_matches_existing_option():
    options = notion_write.select_options(_schema(), "Degree")
    assert _match_option(options, "undergraduate", parse_degree_or_none) == "Бакалавриат"
    assert _match_option(options, "masters", parse_degree_or_none) == "Магистратура"


def test_intake_option_parser_matches_year():
    from app.api.v1.endpoints.notion import _parse_intake_option
    # Опции Intake в живой базе — годы строкой; сопоставляем с intake_year (int).
    options = ["2024", "2025", "2026", "2027"]
    assert _match_option(options, 2026, _parse_intake_option) == "2026"
    assert _match_option(options, 2030, _parse_intake_option) is None
    assert _parse_intake_option("Fall 2025") is None  # не число — не матчим


# --- Двусторонняя синхронизация: канонизация и направление «кто правил последним» ---

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from app.services import notion_sync


def test_field_direction_resolved_when_sides_equal():
    # Стороны совпали — синхронизировать нечего.
    assert notion_sync.field_direction("100.00", "100.00", "100.00") == "resolved"


def test_field_direction_unknown_without_baseline():
    # Эталона ещё нет — направление неизвестно, показываем обе кнопки.
    assert notion_sync.field_direction(None, "100.00", "200.00") == "unknown"


def test_field_direction_notion_newer():
    # CRM держит эталон, Notion изменился → предлагаем «Принять из Notion».
    assert notion_sync.field_direction("100.00", "200.00", "100.00") == "notion_newer"


def test_field_direction_crm_newer():
    # Notion держит эталон, CRM изменился → предлагаем «→ Записать в Notion».
    assert notion_sync.field_direction("100.00", "100.00", "200.00") == "crm_newer"


def test_field_direction_conflict_when_both_diverge():
    # Обе стороны ушли от эталона в разные значения → конфликт.
    assert notion_sync.field_direction("100.00", "200.00", "300.00") == "conflict"


def test_editable_canon_normalizes_both_sides_equally():
    d = {
        "full_name": "  Иван   Иванов ",
        "client_remaining": "750000",
        "client_remaining_date": "2026-06-25",
        "payment_status_raw": "Активная работа",
    }
    student = SimpleNamespace(full_name="иван иванов", phone=None, degree_level=None, intake_year=None)
    contract = SimpleNamespace(
        pipeline_status=None, signed_date=None, amount=None, english_sum=None,
        english_paid=None, client_remaining_amount=Decimal("750000.00"),
        client_remaining_date=date(2026, 6, 25),
    )
    canon = notion_sync.editable_canon(d, student, contract)
    # Имя: схлопнули пробелы и регистр с обеих сторон → совпадает.
    assert canon["full_name"] == ("иван иванов", "иван иванов")
    # Деньги: "750000" и Decimal("750000.00") приводятся к одному виду.
    assert canon["client_remaining"] == ("750000.00", "750000.00")
    # Дата: строка и date → один ISO-вид.
    assert canon["client_remaining_date"] == ("2026-06-25", "2026-06-25")


def test_reconcile_baseline_fixes_only_matching_fields():
    d = {"client_remaining": "750000", "client_fee": "1000000"}
    student = SimpleNamespace(full_name=None, phone=None, degree_level=None, intake_year=None)
    contract = SimpleNamespace(
        pipeline_status=None, signed_date=None, amount=Decimal("999999"),  # ≠ Notion
        english_sum=None, english_paid=None,
        client_remaining_amount=Decimal("750000"),  # == Notion
        client_remaining_date=None,
    )
    snap = SimpleNamespace(normalized_data=d, synced_baseline={})
    notion_sync.reconcile_baseline(snap, student, contract)
    # Совпавшее поле зафиксировано в эталоне, расходящееся — нет.
    assert snap.synced_baseline.get("client_remaining") == "750000.00"
    assert "client_fee" not in snap.synced_baseline
