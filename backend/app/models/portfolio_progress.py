import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Text, DateTime, ForeignKey, Enum as SAEnum, ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class PortfolioStatus(str, enum.Enum):
    not_started = "not_started"
    in_progress = "in_progress"
    completed = "completed"


class FocusArea(str, enum.Enum):
    internships = "internships"
    hackathons = "hackathons"
    olympiads = "olympiads"
    projects = "projects"
    coursera = "coursera"
    conferences = "conferences"
    creative_contests = "creative_contests"
    summer_schools = "summer_schools"


class PortfolioProgress(Base):
    __tablename__ = "portfolio_progress"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), unique=True)
    vpp_group: Mapped[str | None] = mapped_column(String(255), nullable=True)
    first_call_milestone: Mapped[str | None] = mapped_column(String(500), nullable=True)
    deadline_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    focus_areas: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    status: Mapped[PortfolioStatus] = mapped_column(
        SAEnum(PortfolioStatus, name="portfolio_status"), default=PortfolioStatus.not_started
    )
    achievements_count: Mapped[int] = mapped_column(Integer, default=0)
    calls_count: Mapped[int] = mapped_column(Integer, default=0)
    special_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    student: Mapped["Student"] = relationship(back_populates="portfolio_progress")
