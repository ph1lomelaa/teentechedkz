import uuid
from datetime import date
from sqlalchemy import String, Integer, Boolean, Date, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class SubmissionStatus(str, enum.Enum):
    not_started = "not_started"
    documents_prep = "documents_prep"
    submitted = "submitted"
    offer_received = "offer_received"
    rejected = "rejected"
    enrolled = "enrolled"


class VisaStatus(str, enum.Enum):
    not_started = "not_started"
    applied = "applied"
    received = "received"
    refused = "refused"


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    contract_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contracts.id"), nullable=True)
    country: Mapped[str] = mapped_column(String(255))
    # Свободный текст остаётся ведущим: ментор должен иметь возможность указать
    # вуз, которого ещё нет в справочнике. university_id — необязательный
    # указатель рядом; когда он есть, UI показывает фото, флаг и ссылку.
    university: Mapped[str | None] = mapped_column(String(500), nullable=True)
    university_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("universities.id", ondelete="SET NULL"), nullable=True, index=True
    )
    program: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Дедлайн именно этой подачи. У вуза и страны есть свои справочные
    # дедлайны (deadline_note / submission_deadline_notes), но они текстовые и
    # общие — здесь нужна конкретная дата, за которой следит ментор. Пусто —
    # UI показывает справочный ориентир из вуза, иначе из страны.
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    submissions_planned: Mapped[int] = mapped_column(Integer, default=1)
    submissions_done: Mapped[int] = mapped_column(Integer, default=0)
    submission_status: Mapped[SubmissionStatus] = mapped_column(
        SAEnum(SubmissionStatus, name="submission_status"), default=SubmissionStatus.not_started
    )
    visa_status: Mapped[VisaStatus | None] = mapped_column(
        SAEnum(VisaStatus, name="visa_status"), nullable=True
    )
    scholarship_target: Mapped[bool] = mapped_column(Boolean, default=False)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    lead_mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    # lazy="joined" — как в StudentUniversity: заявки почти всегда читаются
    # вместе с вузом (карточка студента, портал), отдельный selectinload в
    # каждом месте только плодил бы шанс забыть его и получить 500.
    university_ref: Mapped["University | None"] = relationship(
        "University", foreign_keys=[university_id], lazy="joined"
    )

    student: Mapped["Student"] = relationship(back_populates="applications")
    contract: Mapped["Contract | None"] = relationship(back_populates="applications", foreign_keys=[contract_id])
    lead_mentor: Mapped["User | None"] = relationship(foreign_keys=[lead_mentor_id])
