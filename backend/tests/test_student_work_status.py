from types import SimpleNamespace

import pytest

from app.services.student_work_status import resolve_work_status
from app.services.notion_field_sync_policy import reconcile_profile_field, FieldSide


def snapshot(raw=None, **baseline):
    return SimpleNamespace(normalized_data={"payment_status_raw": raw}, synced_baseline=baseline)


def test_notion_filled_is_primary_without_changing_stored_crm():
    result = resolve_work_status("on_visa", [snapshot("Работа окончена- Поступил")])
    assert result["pipeline_status"] == "completed_admitted"
    assert result["crm_status"] == "on_visa"
    assert result["status_sync_state"] == "different"


@pytest.mark.parametrize("raw", [None, "", "  ", "Без статуса"])
def test_empty_notion_preserves_portal_status(raw):
    result = resolve_work_status("active_work", [snapshot(raw)])
    assert result["pipeline_status"] == "active_work"
    assert result["status_source"] == "crm"


def test_students_without_contract_or_notion_still_have_explicit_empty_status():
    assert resolve_work_status()["pipeline_status"] == "no_status"


def test_duplicate_links_never_pick_a_page_arbitrarily():
    result = resolve_work_status("paused", [snapshot("Активная работа"), snapshot("На визе")])
    assert result["pipeline_status"] == "paused"
    assert result["status_sync_state"] == "ambiguous_link"


def test_unknown_notion_status_is_exposed_without_discarding_raw():
    result = resolve_work_status(None, [snapshot("Новая опция")])
    assert result["status_sync_state"] == "unrecognized"
    assert result["notion_status_raw"] == "Новая опция"


def test_explicit_portal_status_stays_visible_while_remote_write_is_pending():
    result = resolve_work_status("paused", [snapshot("Активная работа", _portal_status="paused")])
    assert result["pipeline_status"] == "paused"
    assert result["status_sync_state"] == "portal_edit"


def test_confirmed_remote_value_finishes_the_local_override():
    result = resolve_work_status("paused", [snapshot("Пауза", _portal_status="paused")])
    assert result["status_source"] == "notion"
    assert result["status_sync_state"] == "matched"


@pytest.mark.parametrize("baseline,has_baseline", [(None, False), (None, True), ("active_work", True), ("no_status", True)])
def test_empty_notion_is_filled_from_crm_even_with_old_or_missing_baseline(baseline, has_baseline):
    result = reconcile_profile_field(field_key="pipeline_status", baseline=baseline,
        has_baseline=has_baseline, crm_value="paused", notion_value="no_status")
    assert result.can_propagate
    assert result.winner == FieldSide.CRM
    assert result.winning_value == "paused"


def test_empty_phone_does_not_get_status_specific_override():
    result = reconcile_profile_field(field_key="phone", baseline="old", has_baseline=True,
        crm_value="new", notion_value=None)
    assert not result.can_propagate
