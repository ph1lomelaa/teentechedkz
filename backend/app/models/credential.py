import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UniversityCredential(Base):
    """Login/password for a university portal. login/password are stored
    encrypted (Fernet, app.core.encryption) — the plaintext password is only
    returned via an explicit /reveal call to the owner / assigned mentor / admin.
    """

    __tablename__ = "university_credentials"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    university_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("universities.id", ondelete="SET NULL"), nullable=True
    )
    portal_name: Mapped[str] = mapped_column(String(300))
    login_enc: Mapped[str] = mapped_column(Text)       # Fernet ciphertext
    password_enc: Mapped[str] = mapped_column(Text)    # Fernet ciphertext
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
