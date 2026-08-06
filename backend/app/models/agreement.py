"""Электронное подписание регламентов (ОС 30/07, Блок C).

Простая электронная подпись + хеш редакции — не ЭЦП НУЦ РК (см. § 5.2 плана:
NCALayer не работает на телефонах, у части несовершеннолетних студентов нет ключа
ЭЦП). Для гражданско-правовых договоров простой подписи достаточно при согласии
сторон (Цифровой кодекс РК, ст. 47). Слабое место простой подписи закрывается
дёшево: document_sha256 делает любую правку документа доказуемой, а IP/UA/ФИО/чекбокс
в AgreementSignature — Audit Trail поверх записи в AuditLog (техническая трасса
дублируется намеренно: AgreementSignature хранит юридический факт).
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AgreementAudience(str, enum.Enum):
    mentor = "mentor"
    student = "student"
    mzk = "mzk"
    admin = "admin"  # Академ Хэд / Хэд МЗК — только для ознакомления, без принудительной подписи


class AgreementStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"


class Agreement(Base):
    __tablename__ = "agreements"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(300))
    version: Mapped[int] = mapped_column(Integer, default=1)
    audience: Mapped[AgreementAudience] = mapped_column(SAEnum(AgreementAudience, name="agreement_audience"))
    status: Mapped[AgreementStatus] = mapped_column(
        SAEnum(AgreementStatus, name="agreement_status"), default=AgreementStatus.draft
    )
    body_markdown: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Прикреплённый файл (PDF/DOCX) — хранится напрямую в MinIO, без записи в
    # documents (та таблица требует student_id, регламент не привязан к студенту).
    file_storage_path: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    file_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    document_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    country_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    signatures: Mapped[list["AgreementSignature"]] = relationship(
        back_populates="agreement", cascade="all, delete-orphan"
    )


class AgreementSignature(Base):
    __tablename__ = "agreement_signatures"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    agreement_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agreements.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    full_name_typed: Mapped[str] = mapped_column(String(300))
    checkbox_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    # Хеш редакции документа на момент подписи — правка после подписания
    # становится доказуемой (документ больше не совпадает с подписанным хешем).
    document_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    agreement_version: Mapped[int] = mapped_column(Integer)

    agreement: Mapped["Agreement"] = relationship(back_populates="signatures")
    # Нужна списку подписей (GET /agreements/{id}/signatures): full_name_typed —
    # это то, что человек напечатал сам, а показывать надо учётное имя и почту.
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
