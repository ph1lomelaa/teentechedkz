import uuid
from datetime import date, datetime, timezone
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Enum as SAEnum, Date
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class MentorRole(str, enum.Enum):
    lead = "lead"  # ментор по УП (учебный процесс) — регламент МЗК
    ielts = "ielts"
    sat = "sat"
    portfolio = "portfolio"
    visa = "visa"
    english = "english"
    career = "career"  # профориентолог — регламент МЗК
    country = "country"  # ментор по стране — регламент МЗК
    # Единственная роль, которую назначают не ментору, а сотруднику с
    # UserRole.mzk_manager: менеджер ведёт студента целиком, а не предмет.
    # В обязательную команду (required_roles в students.py и гейт этапа в
    # roadmaps.py) намеренно не входит — иначе у всех текущих студентов команда
    # разом стала бы неполной и роадмапы встали бы.
    mzk = "mzk"


# Роли, которые назначают руками. Справочник MentorRole шире: в нём живут и роли
# из старых данных (sat, portfolio, visa, english), а осознанно назначают только
# эти — четыре менторские роли из регламента МЗК плюс сам МЗК.
#
# Порядок тот же, что на экранах (frontend/src/types/index.ts,
# ASSIGNABLE_MENTOR_ROLES). Список один на бэкенд: от него зависят и список
# «кого назначить», и роль по умолчанию при «Взять в работу», и разъехавшись, он
# дал бы специализацию, под которую нельзя назначить.
ASSIGNABLE_ROLES: tuple[MentorRole, ...] = (
    MentorRole.career,
    MentorRole.ielts,
    MentorRole.lead,
    MentorRole.country,
    MentorRole.mzk,
)


# Роли, без которых команда ученика не считается собранной. МЗК сюда намеренно
# не входит (см. комментарий к MentorRole.mzk выше).
#
# Один кортеж на бэкенд: по нему заводятся плейсхолдеры «требуется назначение»
# при создании студента и считается team_readiness в карточке. Пока копий было
# две, любое расхождение означало бы студента, у которого команда «собрана», но
# плейсхолдер на роль так и не завели.
REQUIRED_ROLES: tuple[str, ...] = ("career", "ielts", "lead", "country")


class MentorAssignment(Base):
    __tablename__ = "mentor_assignments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    role: Mapped[MentorRole] = mapped_column(SAEnum(MentorRole, name="mentor_role"))
    country_scope: Mapped[str | None] = mapped_column(String(500), nullable=True)
    functional_zone: Mapped[str | None] = mapped_column(String(500), nullable=True)
    first_task_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    assignment_status: Mapped[str] = mapped_column(String(30), default="active", server_default="active")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    student: Mapped["Student"] = relationship(back_populates="mentor_assignments")
    mentor: Mapped["User"] = relationship(foreign_keys=[mentor_id])
