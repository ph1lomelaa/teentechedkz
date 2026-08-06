import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class University(Base):
    __tablename__ = "universities"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    country_ref_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("country_reference.id", ondelete="SET NULL"), nullable=True
    )
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    name: Mapped[str] = mapped_column(String(400), index=True)
    city: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    world_ranking: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tuition_range: Mapped[str] = mapped_column(String(200), default="")
    # Legacy boolean, kept in sync with has_grants_status == "yes" for existing
    # consumers (schemas, the catalog filter, the legacy CRM page). Superseded
    # by has_grants_status — see below — and to be dropped in a later migration.
    has_grants: Mapped[bool] = mapped_column(Boolean, default=False)
    # "yes" | "no" | "unknown". A plain bool forced "we have no data" to render
    # as "no grants", which misleads a student choosing where to apply: only 88
    # of 200 rows matched the finance spreadsheet at all.
    has_grants_status: Mapped[str] = mapped_column(
        String(20), default="unknown", server_default="unknown"
    )
    # Text, not a bounded String: some spreadsheet cells hold a full list of
    # named scholarships with URLs, well past any sensible varchar limit.
    grant_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    photo_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    degree_levels: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    # Parsed out of the Tilda product body (see services/tilda_text_parser.py),
    # which is the only source covering the whole catalog.
    faculties: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    requirements: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    description_full: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Free-form prose, deliberately not a date: the source text is often stale
    # ("Февраль-июнь 2024 года"), so the UI presents it as reference only.
    deadline_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    deadline_year_mentioned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_tilda_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_sheet_row_ref: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
