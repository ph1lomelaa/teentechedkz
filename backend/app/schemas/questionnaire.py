from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.models.questionnaire import QuestionKind


class QuestionInput(BaseModel):
    kind: QuestionKind = QuestionKind.text
    label: str
    help_text: str = ""
    required: bool = True
    options: list[str] = Field(default_factory=list)


class QuestionnaireCreate(BaseModel):
    title: str
    description: str = ""
    source_notion_page_id: str | None = None
    questions: list[QuestionInput] = Field(default_factory=list)


class QuestionnaireUpdate(BaseModel):
    title: str | None = None
    description: str | None = None


class QuestionsPut(BaseModel):
    questions: list[QuestionInput] = Field(default_factory=list)


class RespondIn(BaseModel):
    # { question_id: value }, value is str | bool | list[str]
    answers: dict[str, Any] = Field(default_factory=dict)
    submit: bool = True  # False => save draft answers without marking submitted
