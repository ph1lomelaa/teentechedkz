"""Native questionnaires attached to roadmap tasks.

Replaces the imported Notion `АНКЕТА` links (dead `/p/<hash>` URLs): staff build a
structured questionnaire on a roadmap task, send it to the student, the student
fills it in their cabinet, answers are stored, and the mentor reviews them — all
inside the platform. `source_notion_page_id` keeps the link back to the original
Notion form so it can later be imported/populated automatically.
"""
import uuid
from datetime import datetime, timezone
import enum

from sqlalchemy import String, Text, Boolean, Integer, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class QuestionnaireStatus(str, enum.Enum):
    draft = "draft"            # mentor is building it
    sent = "sent"             # sent to student, awaiting fill
    submitted = "submitted"   # student submitted answers
    reviewed = "reviewed"     # mentor reviewed the answers


class QuestionKind(str, enum.Enum):
    text = "text"             # short free text
    long_text = "long_text"   # multiline free text
    choice = "choice"         # single choice from options
    multi = "multi"           # multiple choice from options
    bool = "bool"             # yes / no


class Questionnaire(Base):
    __tablename__ = "questionnaires"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    roadmap_task_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("roadmap_tasks.id", ondelete="CASCADE"), nullable=True, unique=True, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[QuestionnaireStatus] = mapped_column(
        SAEnum(QuestionnaireStatus, name="questionnaire_status"), default=QuestionnaireStatus.draft
    )
    source_notion_page_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    questions: Mapped[list["QuestionnaireQuestion"]] = relationship(
        back_populates="questionnaire", cascade="all, delete-orphan", order_by="QuestionnaireQuestion.position"
    )
    response: Mapped["QuestionnaireResponse | None"] = relationship(
        back_populates="questionnaire", cascade="all, delete-orphan", uselist=False
    )


class QuestionnaireQuestion(Base):
    __tablename__ = "questionnaire_questions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questionnaires.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[QuestionKind] = mapped_column(
        SAEnum(QuestionKind, name="questionnaire_question_kind"), default=QuestionKind.text
    )
    label: Mapped[str] = mapped_column(Text)
    help_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    required: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    options: Mapped[list] = mapped_column(JSONB, default=list)  # for choice/multi
    position: Mapped[int] = mapped_column(Integer, default=0)

    questionnaire: Mapped["Questionnaire"] = relationship(back_populates="questions")


class QuestionnaireResponse(Base):
    __tablename__ = "questionnaire_responses"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    questionnaire_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questionnaires.id", ondelete="CASCADE"), unique=True, index=True
    )
    # { question_id(str): value }, value is str | bool | list[str]
    answers: Mapped[dict] = mapped_column(JSONB, default=dict)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    questionnaire: Mapped["Questionnaire"] = relationship(back_populates="response")
