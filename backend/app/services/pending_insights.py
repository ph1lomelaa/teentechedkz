"""The review queue and all counters use the same definition of a real change.

Reading the queue never marks an AI suggestion as approved or modifies a
student. Suggestions already equal to the current profile simply need no review.
"""
from sqlalchemy import and_, exists, func, literal, or_, select
from sqlalchemy.dialects.postgresql import JSONB

from app.models.pending_insight import InsightStatus, PendingInsight
from app.models.student import Student
from app.services.student_notes import NOTEABLE_FIELDS, build_profile_diff, snapshot_student


def needs_review(student: Student, insight: PendingInsight) -> bool:
    return bool(insight.unmatched_fields or build_profile_diff(snapshot_student(student), insight.proposed_changes or {}))


def needs_review_condition():
    changes = PendingInsight.proposed_changes
    changed_fields = or_(*(
        and_(changes.has_key(field), func.coalesce(func.to_jsonb(getattr(Student, field)), literal(None, type_=JSONB)).is_distinct_from(changes[field]))  # noqa: W601
        for field in NOTEABLE_FIELDS
    ))
    profile_changed = exists(
        select(1).select_from(Student)
        .where(Student.id == PendingInsight.student_id, changed_fields)
        .correlate(PendingInsight)
    )
    unmatched = PendingInsight.unmatched_fields
    return or_(
        and_(unmatched.is_not(None), unmatched != literal({}, type_=JSONB), unmatched != literal(None, type_=JSONB)),
        profile_changed,
    )


def visible_insight_condition():
    """Keep resolved history intact; only actionable pending rows need review."""
    return or_(PendingInsight.status != InsightStatus.pending, needs_review_condition())
