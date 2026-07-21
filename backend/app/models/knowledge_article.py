"""Read-only reference content imported from curated Notion pages (scholarship
rules, mentor regulations, package tables) — distinct from roadmap templates,
which track a step-by-step task schema rather than free-form reference text.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class KnowledgeArticle(Base):
    __tablename__ = "knowledge_articles"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(500))
    category: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    body_html: Mapped[str] = mapped_column(Text, default="", server_default="")
    source_notion_page_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    source_notion_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_last_edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
