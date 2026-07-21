from app.core.import_notion_questionnaires import _questions_from_db


def _wrapped(value):
    return {"value": {"value": value}}


def test_form_question_descriptions_override_database_property_metadata():
    dbjson = {
        "properties": {
            "Короткое имя": {"id": "%3Bpyv", "type": "rich_text", "rich_text": {}},
            "Когда недоступны": {"id": "%5Bkl%7D", "type": "rich_text", "rich_text": {}},
        }
    }
    payload = {
        "recordMap": {
            "form_question": {
                "q1": _wrapped({"config": {
                    "name": [["Ваши планы по таймингам"]],
                    "description": [["В каком месяце планируете подаваться?"]],
                    "propertyId": ";pyv",
                    "required": True,
                    "propertyTypeSpecificConfig": {"text": {"longAnswer": True}},
                }}),
                "q2": _wrapped({"config": {
                    "name": [["Недоступные даты"]],
                    "description": [["Укажите даты и продолжительность."]],
                    "propertyId": "[kl}",
                    "required": False,
                }}),
            },
            "layout": {
                "layout1": _wrapped({"modules": {"form_layout_schema": [
                    {"type": "formQuestion", "formQuestionId": "q1"},
                    {"type": "formQuestion", "formQuestionId": "q2"},
                ]}})
            },
        }
    }

    questions = _questions_from_db(dbjson, form_payload=payload)

    assert [question["label"] for question in questions] == [
        "Ваши планы по таймингам",
        "Недоступные даты",
    ]
    assert questions[0]["help_text"] == "В каком месяце планируете подаваться?"
    assert questions[0]["kind"] == "long_text"
    assert questions[0]["required"] is True
    assert questions[1]["help_text"] == "Укажите даты и продолжительность."
