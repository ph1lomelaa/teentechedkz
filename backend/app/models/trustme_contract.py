import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TrustMeContractLink(Base):
    __tablename__ = "trustme_contract_links"
    __table_args__ = (UniqueConstraint("company_id", "external_id", name="uq_trustme_company_document"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    financial_contract_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contracts.id", ondelete="RESTRICT"), nullable=True, index=True)
    company_id: Mapped[str] = mapped_column(String(64))
    external_id: Mapped[str] = mapped_column(String(64))
    short_url: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(1000))
    number: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[int] = mapped_column(Integer)
    signers: Mapped[list] = mapped_column(JSON, default=list)
    contract_created_at: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="trustme", server_default="trustme")
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    signed_date_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    profile_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    linked_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
