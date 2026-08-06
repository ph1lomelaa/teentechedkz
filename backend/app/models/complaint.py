"""Книга жалоб и рекомендаций (ОС 30/07, Блок D).

SLA = first_response_at − created_at > 24ч (Прил. № 3, п. 2.1). По п. 1.3.4
регламента «принято/увидел/позже отвечу» не считается надлежащим ответом —
first_response_at ставится только на первый ComplaintReply, не на просмотр.

visible_to_role переиспользует NoteVisibility (ConfidentialNote) — та же модель
трёхуровневой видимости персонала, дефолт admin_only: жалоба на ментора не
видна ему самому в его карточке, пока явно не открыта шире.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.confidential_note import NoteVisibility


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ComplaintKind(str, enum.Enum):
    complaint = "complaint"
    recommendation = "recommendation"


class ComplaintCategory(str, enum.Enum):
    student = "student"
    parent = "parent"
    deadline = "deadline"
    quality = "quality"
    specialist_change = "specialist_change"
    communication = "communication"
    refund = "refund"
    suggestion = "suggestion"
    other = "other"


class ApplicantType(str, enum.Enum):
    student = "student"
    parent = "parent"
    employee = "employee"
    other = "other"


class ComplaintStatus(str, enum.Enum):
    new = "new"
    in_progress = "in_progress"
    answered = "answered"
    closed = "closed"


class Complaint(Base):
    __tablename__ = "complaints"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    author_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("students.id", ondelete="SET NULL"), nullable=True, index=True
    )
    kind: Mapped[ComplaintKind] = mapped_column(SAEnum(ComplaintKind, name="complaint_kind"))
    applicant_type: Mapped[ApplicantType] = mapped_column(
        SAEnum(ApplicantType, name="complaint_applicant_type"), default=ApplicantType.student
    )
    category: Mapped[ComplaintCategory] = mapped_column(
        SAEnum(ComplaintCategory, name="complaint_category"), default=ComplaintCategory.other
    )
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    original_body: Mapped[str] = mapped_column(Text)
    intermediate_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    final_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmation: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[ComplaintStatus] = mapped_column(
        SAEnum(ComplaintStatus, name="complaint_status"), default=ComplaintStatus.new, index=True
    )
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    visible_to_role: Mapped[NoteVisibility] = mapped_column(
        SAEnum(NoteVisibility, name="note_visibility"), default=NoteVisibility.admin_only
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_sla_breached: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    risk_level: Mapped[str] = mapped_column(String(20), default="normal", nullable=False)
    legal_escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    legal_escalation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    author: Mapped["User"] = relationship(foreign_keys=[author_user_id])
    assignee: Mapped["User | None"] = relationship(foreign_keys=[assigned_to])
    # The endpoint selectinload()s this and _complaint_to_dict reads
    # c.student.full_name, but the relationship was never declared — every
    # GET /complaints raised AttributeError → 500.
    student: Mapped["Student | None"] = relationship(foreign_keys=[student_id])
    replies: Mapped[list["ComplaintReply"]] = relationship(
        back_populates="complaint", cascade="all, delete-orphan", order_by="ComplaintReply.created_at"
    )


class ComplaintReply(Base):
    __tablename__ = "complaint_replies"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    complaint_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("complaints.id", ondelete="CASCADE"), index=True)
    author_user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Автор обращения всегда видит свои ответы; visible_to_author=False скрывает
    # внутреннюю переписку персонала (например, обсуждение перед ответом) от
    # студента/ментора-автора, не влияя на видимость самой жалобы (visible_to_role).
    visible_to_author: Mapped[bool] = mapped_column(Boolean, default=True)

    complaint: Mapped["Complaint"] = relationship(back_populates="replies")
    author: Mapped["User"] = relationship(foreign_keys=[author_user_id])
