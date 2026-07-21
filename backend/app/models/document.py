import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Integer, Boolean, Text, DateTime, ForeignKey, Numeric, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class DocType(str, enum.Enum):
    certificate = "certificate"
    achievement = "achievement"
    id_scan = "id_scan"
    offer_letter = "offer_letter"
    contract_scan = "contract_scan"
    transcript = "transcript"
    resume = "resume"
    other = "other"


class DocSource(str, enum.Enum):
    telegram = "telegram"
    whatsapp = "whatsapp"
    manual_upload = "manual_upload"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    service_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("services.id", ondelete="SET NULL"), nullable=True, index=True)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    doc_type: Mapped[DocType] = mapped_column(SAEnum(DocType, name="doc_type"))
    file_name: Mapped[str] = mapped_column(String(500))
    file_size: Mapped[int] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(100))
    storage_path: Mapped[str] = mapped_column(String(2048))
    source_telegram_attachment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("telegram_attachments.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
        index=True,
    )
    source: Mapped[DocSource] = mapped_column(SAEnum(DocSource, name="doc_source"), default=DocSource.manual_upload)
    ai_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_doc_type_confidence: Mapped[float | None] = mapped_column(Numeric(4, 3), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Whether the student sees this document in their portal (false = internal only).
    visible_to_student: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="documents")
    uploader: Mapped["User"] = relationship(foreign_keys=[uploaded_by])
