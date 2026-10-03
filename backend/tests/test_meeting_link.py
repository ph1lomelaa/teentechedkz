import pytest
from pydantic import ValidationError

from app.schemas.meeting import MeetingCreate, MeetingUpdate, normalize_meeting_link


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("", ""),
        ("   ", ""),
        (None, None),
        ("https://zoom.us/j/123", "https://zoom.us/j/123"),
        ("zoom.us/j/123", "https://zoom.us/j/123"),
        (" meet.google.com/abc-defg-hij ", "https://meet.google.com/abc-defg-hij"),
    ],
)
def test_normalize_ok(raw, expected):
    assert normalize_meeting_link(raw) == expected


@pytest.mark.parametrize("raw", ["ss", "/students", "javascript:alert(1)", "ftp://x.com/a", "две слова.ru"])
def test_normalize_rejects_garbage(raw):
    with pytest.raises(ValueError):
        normalize_meeting_link(raw)


def test_schemas_apply_normalization():
    base = dict(student_id="11111111-1111-1111-1111-111111111111", title="t", starts_at="2026-10-05T10:00:00Z", ends_at="2026-10-05T11:00:00Z")
    assert MeetingCreate(**base, meeting_link="zoom.us/j/1").meeting_link == "https://zoom.us/j/1"
    assert MeetingCreate(**base).meeting_link == ""
    with pytest.raises(ValidationError):
        MeetingCreate(**base, meeting_link="ss")
    assert MeetingUpdate().meeting_link is None
    with pytest.raises(ValidationError):
        MeetingUpdate(meeting_link="ss")
