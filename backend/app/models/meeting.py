import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class MeetingStatus(str, enum.Enum):
    scheduled = "scheduled"
    completed = "completed"
    cancelled = "cancelled"


class MeetingType(str, enum.Enum):
    intro = "intro"
    regular = "regular"
    documents = "documents"
    roadmap = "roadmap"
    application = "application"
    finance = "finance"
    other = "other"
    # Блок E (ОС 30/07): расписание IELTS — переиспользуем Meeting вместо новой
    # сущности, бесплатно подхватываются iCal-экспорт, календарь, напоминания.
    ielts_lesson = "ielts_lesson"
    ielts_mock = "ielts_mock"


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"), nullable=True, index=True)
    mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(500))
    meeting_type: Mapped[MeetingType] = mapped_column(
        SAEnum(MeetingType, name="meeting_type"), default=MeetingType.regular
    )
    description: Mapped[str] = mapped_column(Text, default="")
    outcome: Mapped[str] = mapped_column(Text, default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    meeting_link: Mapped[str] = mapped_column(String(2048), default="")
    recording_url: Mapped[str] = mapped_column(String(2048), default="")
    transcript_url: Mapped[str] = mapped_column(String(2048), default="")
    status: Mapped[MeetingStatus] = mapped_column(
        SAEnum(MeetingStatus, name="meeting_status"), default=MeetingStatus.scheduled
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    note_session: Mapped["NoteSession | None"] = relationship(
        back_populates="meeting",
        uselist=False,
        foreign_keys="NoteSession.meeting_id",
    )

    @property
    def note_session_id(self) -> uuid.UUID | None:
        # Response serialization runs outside SQLAlchemy's async greenlet.
        # Never trigger an implicit relationship query from a plain property;
        # endpoints that need the linked session already eager-load it.
        note_session = self.__dict__.get("note_session")
        return note_session.id if note_session else None
