import uuid
from sqlalchemy import String, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class CountryReference(Base):
    __tablename__ = "country_reference"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    country_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    vpp_required: Mapped[bool] = mapped_column(Boolean, default=False)
    submission_deadline_notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
