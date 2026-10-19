import pytest
from app.models.confidential_note import NoteVisibility, note_visible_to_role, student_note_visible_to_role
from app.models.user import UserRole


@pytest.mark.parametrize('role', [UserRole.admin, UserRole.mzk_manager, UserRole.academic_head])
@pytest.mark.parametrize('visibility', list(NoteVisibility))
def test_supervisors_can_read_every_student_note(role, visibility):
    assert student_note_visible_to_role(visibility, role)


@pytest.mark.parametrize('role', [UserRole.mentor, UserRole.student])
@pytest.mark.parametrize('visibility', [NoteVisibility.admin_only, NoteVisibility.admin_and_mzk])
def test_supervision_does_not_expose_confidential_notes_to_mentor_or_student(role, visibility):
    assert not student_note_visible_to_role(visibility, role)


@pytest.mark.parametrize('role', [UserRole.mzk_manager, UserRole.academic_head])
def test_student_review_does_not_change_admin_only_edit_or_complaint_policy(role):
    assert student_note_visible_to_role(NoteVisibility.admin_only, role)
    assert not note_visible_to_role(NoteVisibility.admin_only, role)
