from app.models.intake_submission import IntakeSource
from app.services.sheets_sync import map_row


def test_landing_application_fields_map_to_student_fields() -> None:
    raw = {
        "full_name": "Тестовый Студент",
        "phone": "+7 700 000 00 00",
        "email": "student@example.test",
        "city": "Алматы",
        "degree_level": "undergraduate",
        "intake_year": 2028,
        "target_country": "США",
        "program_interest": "Computer Science",
        "message": "Нужна консультация",
        "source": "landing_apply",
    }

    mapped = map_row(list(raw), list(raw.values()), IntakeSource.cases)

    assert mapped["full_name"] == "Тестовый Студент"
    assert mapped["phone"] == "+7 700 000 00 00"
    assert mapped["city"] == "Алматы"
    assert mapped["degree_level"] == "undergraduate"
    assert mapped["intake_year"] == "2028"
    assert mapped["countries"] == "США"
    assert mapped["specialty"] == "Computer Science"
