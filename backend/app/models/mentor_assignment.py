import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class MentorRole(str, enum.Enum):
    lead = "lead"
    ielts = "ielts"
    sat = "sat"
    portfolio = "portfolio"
    visa = "visa"
    english = "english"
    career = "career"


class MentorAssignment(Base):
    __tablename__ = "mentor_assignments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    mentor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    role: Mapped[MentorRole] = mapped_column(SAEnum(MentorRole, name="mentor_role"))
    country_scope: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="mentor_assignments")
    mentor: Mapped["User"] = relationship(foreign_keys=[mentor_id])
