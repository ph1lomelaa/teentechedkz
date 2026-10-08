"""Pure policy for reconciling one shared CRM/Notion field.

This module deliberately performs no reads, writes, or normalization. Callers
must supply values normalized with the same field-specific canonicalizer and a
baseline that represents the last confirmed common value.

Only explicit, trustworthy *field edit events* may order a two-sided conflict.
Do not construct :class:`FieldEditEvent` values from Notion page-level
``last_edited_at`` or the row-wide ``Student.updated_at``; neither proves when
this particular field changed.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Generic, TypeVar


T = TypeVar("T")


class FieldDecision(str, Enum):
    """Classification of current values relative to their shared baseline."""

    RESOLVED = "resolved"
    CRM_CHANGED = "crm_changed"
    NOTION_CHANGED = "notion_changed"
    CONFLICT = "conflict"
    UNKNOWN_BASELINE = "unknown_baseline"
    UNSAFE_CLEAR = "unsafe_clear"


class FieldSide(str, Enum):
    CRM = "crm"
    NOTION = "notion"


class FieldEventScope(str, Enum):
    """Timestamp scopes; only the two field scopes may order conflicts."""

    CRM_FIELD = "crm_field"
    NOTION_FIELD = "notion_field"
    CRM_ROW = "crm_row"
    NOTION_PAGE = "notion_page"


@dataclass(frozen=True)
class FieldEditEvent:
    """Trustworthy timestamp emitted by a field-specific edit event.

    The scope is explicit so callers cannot accidentally pass a general row or
    page timestamp without making that misuse visible in code review.
    """

    scope: FieldEventScope
    edited_at: datetime
    trustworthy: bool = True

    def __post_init__(self) -> None:
        if self.edited_at.tzinfo is None or self.edited_at.utcoffset() is None:
            raise ValueError("field edit timestamps must be timezone-aware")


@dataclass(frozen=True)
class ReconciliationResult(Generic[T]):
    """Policy output; original values are always retained for review."""

    decision: FieldDecision
    crm_value: T
    notion_value: T
    winner: FieldSide | None = None

    @property
    def can_propagate(self) -> bool:
        """Whether policy identifies a safe single value to propagate."""

        return self.decision in {
            FieldDecision.CRM_CHANGED,
            FieldDecision.NOTION_CHANGED,
            FieldDecision.CONFLICT,
        } and self.winner is not None

    @property
    def winning_value(self) -> T | None:
        """Value selected by policy, or ``None`` when ambiguity must be kept."""

        if self.winner is FieldSide.CRM:
            return self.crm_value
        if self.winner is FieldSide.NOTION:
            return self.notion_value
        return None


def _is_empty(value: object) -> bool:
    """Treat null and whitespace-only strings as empty for clear protection."""

    return value is None or (isinstance(value, str) and not value.strip())


def _later_field_side(
    crm_event: FieldEditEvent | None,
    notion_event: FieldEditEvent | None,
) -> FieldSide | None:
    """Return the later side only when both matching field events are trusted."""

    if (
        crm_event is None
        or notion_event is None
        or not crm_event.trustworthy
        or not notion_event.trustworthy
        or crm_event.scope is not FieldEventScope.CRM_FIELD
        or notion_event.scope is not FieldEventScope.NOTION_FIELD
    ):
        return None
    if crm_event.edited_at > notion_event.edited_at:
        return FieldSide.CRM
    if notion_event.edited_at > crm_event.edited_at:
        return FieldSide.NOTION
    return None


def reconcile_field(
    *,
    baseline: T | None,
    has_baseline: bool,
    crm_value: T,
    notion_value: T,
    crm_event: FieldEditEvent | None = None,
    notion_event: FieldEditEvent | None = None,
    crm_clear_confirmed: bool = False,
    notion_clear_confirmed: bool = False,
) -> ReconciliationResult[T]:
    """Classify one field and optionally select a safe propagation winner.

    Empty values are treated as unsafe clears by default. A caller may mark a
    clear as confirmed only when it has explicit evidence of a human field
    edit that intentionally cleared the value. Missing baseline is distinct
    from a baseline whose value is ``None`` via ``has_baseline``.

    On a two-sided conflict, the decision remains ``CONFLICT`` even if trusted
    field events establish a winner; callers can record the conflict and use
    ``winner`` to resolve it. Equal timestamps, missing events, untrusted events
    or mismatched event scopes leave ``winner`` unset and preserve both values.
    """

    result = lambda decision, winner=None: ReconciliationResult(
        decision=decision,
        crm_value=crm_value,
        notion_value=notion_value,
        winner=winner,
    )

    if crm_value == notion_value:
        return result(FieldDecision.RESOLVED)
    if not has_baseline:
        return result(FieldDecision.UNKNOWN_BASELINE)

    crm_changed = crm_value != baseline
    notion_changed = notion_value != baseline
    if not crm_changed and not notion_changed:
        return result(FieldDecision.RESOLVED)

    unsafe_crm_clear = crm_changed and _is_empty(crm_value) and not crm_clear_confirmed
    unsafe_notion_clear = (
        notion_changed and _is_empty(notion_value) and not notion_clear_confirmed
    )
    if unsafe_crm_clear or unsafe_notion_clear:
        return result(FieldDecision.UNSAFE_CLEAR)

    if crm_changed and not notion_changed:
        return result(FieldDecision.CRM_CHANGED, FieldSide.CRM)
    if notion_changed and not crm_changed:
        return result(FieldDecision.NOTION_CHANGED, FieldSide.NOTION)

    return result(
        FieldDecision.CONFLICT,
        _later_field_side(crm_event, notion_event),
    )
