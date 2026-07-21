"""Reusable questionnaire templates imported from Notion form backing databases.

Notion's АНКЕТА links point at native Notion *form blocks*, which the Notion API
refuses to expose ("Block type form is not supported via the API"). But every form
writes into a backing **database** titled `<Country> <Degree> ⇒ <STEP>` whose
properties are exactly the form's questions — and databases *are* readable. We
import those databases here as reusable templates; a mentor picks the matching one
in the questionnaire dialog to populate a task's questionnaire in one click.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class QuestionnaireTemplate(Base):
    __tablename__ = "questionnaire_templates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_notion_db_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    # 32-hex id (no dashes) of the Notion *form block* whose parent is this backing
    # database. Roadmap/template tasks store this in questionnaire_url ("/p/<id>"),
    # so it is the offline join key task -> questionnaire template.
    source_form_block_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500))
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    degree: Mapped[str | None] = mapped_column(String(40), nullable=True)
    step_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # list of {kind, label, options: [str], required: bool, position: int}
    questions: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
