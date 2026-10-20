from app.models.student import Student, DegreeLevel
from app.models.pending_insight import PendingInsight
from app.services.pending_insights import needs_review


def student():
    return Student(full_name="Анна", city="Алматы", degree_level=DegreeLevel.undergraduate)


def test_matching_values_and_empty_suggestions_do_not_need_review():
    for changes in ({}, {"city": "Алматы"}, {"age": None}, {"degree_level": "undergraduate"}):
        assert not needs_review(student(), PendingInsight(proposed_changes=changes))


def test_changed_profile_and_unmatched_context_need_review():
    assert needs_review(student(), PendingInsight(proposed_changes={"city": "Астана"}))
    assert needs_review(student(), PendingInsight(proposed_changes={}, unmatched_fields={"context_note": "Нужно обсудить"}))


def test_reading_queue_never_applies_or_approves_a_suggestion():
    person = student()
    insight = PendingInsight(proposed_changes={"city": "Алматы"})
    original_status = insight.status
    assert not needs_review(person, insight)
    assert person.city == "Алматы"
    assert insight.status == original_status
    assert insight.reviewed_by is None
