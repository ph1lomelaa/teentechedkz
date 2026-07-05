import uuid
from datetime import datetime, date, timezone
from sqlalchemy import String, Integer, Text, Date, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class CommSource(str, enum.Enum):
    telegram = "telegram"
    whatsapp = "whatsapp"
    zoom = "zoom"
    manual = "manual"


class MessageType(str, enum.Enum):
    text_event = "text_event"
    attachment = "attachment"
    call_transcript = "call_transcript"
    general_chat = "general_chat"


class CommunicationLog(Base):
    __tablename__ = "communication_log"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    source: Mapped[CommSource] = mapped_column(SAEnum(CommSource, name="comm_source"))
    message_type: Mapped[MessageType] = mapped_column(SAEnum(MessageType, name="message_type"))
    raw_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    zoom_call_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    zoom_duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="communication_logs")
    pending_insights: Mapped[list["PendingInsight"]] = relationship(back_populates="communication_log")
