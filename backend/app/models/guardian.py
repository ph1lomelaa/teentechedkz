import uuid
from sqlalchemy import String, Boolean, ForeignKey, Enum as SAEnum, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class GuardianRelation(str, enum.Enum):
    self = "self"
    parent = "parent"
    guardian = "guardian"


class Guardian(Base):
    __tablename__ = "guardians"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    full_name: Mapped[str] = mapped_column(String(500))
    # IIN stored encrypted via pgcrypto — raw bytes column
    iin_encrypted: Mapped[str | None] = mapped_column("iin_encrypted", String(1024), nullable=True)
    phone: Mapped[str] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    relation: Mapped[GuardianRelation] = mapped_column(SAEnum(GuardianRelation, name="guardian_relation"))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=True)

    student: Mapped["Student"] = relationship(back_populates="guardians")
