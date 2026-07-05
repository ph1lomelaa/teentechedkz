import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Text, DateTime, Boolean, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class DegreeLevel(str, enum.Enum):
    undergraduate = "undergraduate"
    masters = "masters"
    foundation = "foundation"
    found_ug = "found_ug"


class IntakeSeason(str, enum.Enum):
    fall = "fall"
    spring = "spring"


class Student(Base):
    __tablename__ = "students"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    full_name: Mapped[str] = mapped_column(String(500), index=True)
    phone: Mapped[str] = mapped_column(String(100), index=True)
    city: Mapped[str | None] = mapped_column(String(500), nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    degree_level: Mapped[DegreeLevel] = mapped_column(SAEnum(DegreeLevel, name="degree_level"))
    specialty: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_direction: Mapped[str | None] = mapped_column(Text, nullable=True)
    additional_sphere: Mapped[str | None] = mapped_column(Text, nullable=True)
    gpa: Mapped[str | None] = mapped_column(Text, nullable=True)
    achievements_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    budget_per_year: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_resume_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    intake_year: Mapped[int] = mapped_column(Integer)
    intake_season: Mapped[IntakeSeason | None] = mapped_column(
        SAEnum(IntakeSeason, name="intake_season"), nullable=True
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    guardians: Mapped[list["Guardian"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    contracts: Mapped[list["Contract"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    applications: Mapped[list["Application"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    mentor_assignments: Mapped[list["MentorAssignment"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    services: Mapped[list["Service"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    portfolio_progress: Mapped["PortfolioProgress | None"] = relationship(back_populates="student", uselist=False, cascade="all, delete-orphan")
    confidential_notes: Mapped[list["ConfidentialNote"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    student_tasks: Mapped[list["StudentTask"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    documents: Mapped[list["Document"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    communication_logs: Mapped[list["CommunicationLog"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    pending_insights: Mapped[list["PendingInsight"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    notes: Mapped[list["StudentNote"]] = relationship(back_populates="student")
    note_sessions: Mapped[list["NoteSession"]] = relationship(back_populates="student", cascade="all, delete-orphan")
