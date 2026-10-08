from datetime import datetime, timezone

import pytest

from app.services.notion_field_sync_policy import (
    FieldDecision,
    FieldEditEvent,
    FieldEventScope,
    FieldSide,
    reconcile_field,
)


def event(scope: FieldEventScope, hour: int, *, trustworthy: bool = True) -> FieldEditEvent:
    return FieldEditEvent(
        scope=scope,
        edited_at=datetime(2026, 10, 8, hour, tzinfo=timezone.utc),
        trustworthy=trustworthy,
    )


def test_matching_values_are_resolved_even_without_a_baseline():
    result = reconcile_field(
        baseline=None, has_baseline=False, crm_value="same", notion_value="same"
    )

    assert result.decision is FieldDecision.RESOLVED
    assert result.winner is None


def test_different_values_without_a_baseline_are_preserved_as_unknown():
    result = reconcile_field(
        baseline=None, has_baseline=False, crm_value="CRM", notion_value="Notion"
    )

    assert result.decision is FieldDecision.UNKNOWN_BASELINE
    assert result.crm_value == "CRM"
    assert result.notion_value == "Notion"
    assert not result.can_propagate


@pytest.mark.parametrize(
    ("crm_value", "notion_value", "decision", "winner"),
    [
        ("new CRM", "old", FieldDecision.CRM_CHANGED, FieldSide.CRM),
        ("old", "new Notion", FieldDecision.NOTION_CHANGED, FieldSide.NOTION),
        ("old", "old", FieldDecision.RESOLVED, None),
    ],
)
def test_one_sided_changes_and_unchanged_values(
    crm_value, notion_value, decision, winner
):
    result = reconcile_field(
        baseline="old",
        has_baseline=True,
        crm_value=crm_value,
        notion_value=notion_value,
    )

    assert result.decision is decision
    assert result.winner is winner


def test_two_sided_conflict_uses_later_trustworthy_field_event():
    result = reconcile_field(
        baseline="old",
        has_baseline=True,
        crm_value="new CRM",
        notion_value="new Notion",
        crm_event=event(FieldEventScope.CRM_FIELD, 11),
        notion_event=event(FieldEventScope.NOTION_FIELD, 12),
    )

    assert result.decision is FieldDecision.CONFLICT
    assert result.winner is FieldSide.NOTION
    assert result.winning_value == "new Notion"
    assert result.crm_value == "new CRM"
    assert result.notion_value == "new Notion"


@pytest.mark.parametrize(
    ("crm_event", "notion_event"),
    [
        (None, event(FieldEventScope.NOTION_FIELD, 12)),
        (event(FieldEventScope.CRM_FIELD, 11, trustworthy=False), event(FieldEventScope.NOTION_FIELD, 12)),
        (event(FieldEventScope.CRM_FIELD, 12), event(FieldEventScope.NOTION_FIELD, 12)),
        # A page-level timestamp cannot stand in for a Notion field event.
        (event(FieldEventScope.CRM_FIELD, 11), event(FieldEventScope.NOTION_PAGE, 12)),
    ],
)
def test_conflict_stays_unresolved_without_two_ordered_field_events(
    crm_event, notion_event
):
    result = reconcile_field(
        baseline="old",
        has_baseline=True,
        crm_value="new CRM",
        notion_value="new Notion",
        crm_event=crm_event,
        notion_event=notion_event,
    )

    assert result.decision is FieldDecision.CONFLICT
    assert result.winner is None
    assert not result.can_propagate
    assert result.crm_value == "new CRM"
    assert result.notion_value == "new Notion"


@pytest.mark.parametrize(
    ("crm_value", "notion_value", "kwargs"),
    [
        (None, "old", {}),
        ("old", "   ", {}),
        (None, "new Notion", {"crm_clear_confirmed": False}),
    ],
)
def test_unconfirmed_clear_is_unsafe(crm_value, notion_value, kwargs):
    result = reconcile_field(
        baseline="old",
        has_baseline=True,
        crm_value=crm_value,
        notion_value=notion_value,
        **kwargs,
    )

    assert result.decision is FieldDecision.UNSAFE_CLEAR
    assert result.winner is None
    assert result.crm_value == crm_value
    assert result.notion_value == notion_value


def test_explicitly_confirmed_one_sided_clear_can_propagate():
    result = reconcile_field(
        baseline="old",
        has_baseline=True,
        crm_value=None,
        notion_value="old",
        crm_clear_confirmed=True,
    )

    assert result.decision is FieldDecision.CRM_CHANGED
    assert result.winner is FieldSide.CRM


def test_null_can_be_a_known_baseline_value():
    result = reconcile_field(
        baseline=None,
        has_baseline=True,
        crm_value="new CRM",
        notion_value=None,
    )

    assert result.decision is FieldDecision.CRM_CHANGED
    assert result.winner is FieldSide.CRM


def test_naive_timestamp_is_rejected():
    with pytest.raises(ValueError, match="timezone-aware"):
        FieldEditEvent(
            scope=FieldEventScope.CRM_FIELD,
            edited_at=datetime(2026, 10, 8, 11),
        )
