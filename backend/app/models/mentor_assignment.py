import uuid
from datetime import date, datetime, timezone
from sqlalchemy import String, Boolean, DateTime, ForeignKey, Enum as SAEnum, Date, Index, text
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


# Роли, в которых у ученика может быть несколько активных ответственных сразу.
#
# Всё остальное — ровно один человек на роль, и это не соглашение, а инвариант в
# четырёх слоях: уникальный индекс в БД, замена прежнего в `_assign_one`, отказ
# «роль уже занята» в `assign_self`, кнопка «Заменить» вместо «Добавить» в
# карточке. Множественность включается адресно, потому что цена общая: пока
# ответственный один, «главный ментор» студента и счётчики доски однозначны.
#
# `country` в списке потому, что ученик подаётся в несколько стран, и страну
# ведёт свой человек. Различает их `country_scope` — со второго ответственного
# он обязателен (см. create_assignment) и входит в уникальный индекс.
MULTI_ROLES: frozenset[MentorRole] = frozenset({MentorRole.country})


class MentorAssignment(Base):
    __tablename__ = "mentor_assignments"

    # Индексы продублированы здесь и в миграциях 093/095 намеренно. Прод растёт
    # миграциями, но чистая база поднимается иначе — `bootstrap_db` делает
    # create_all и сразу штампует head, поэтому `alembic upgrade head` на ней
    # ничего не выполняет. Пока индексы жили только в миграции, в CI и на новых
    # машинах их не было вовсе: там ограничение просто не проверялось, и тест,
    # ожидающий отказ на дубле, прошёл бы мимо дефекта.
    __table_args__ = (
        Index(
            "uq_mentor_assignment_active_role",
            "student_id",
            "role",
            unique=True,
            postgresql_where=text(
                "is_active AND mentor_id IS NOT NULL AND role <> 'country'"
            ),
        ),
        # Роль из MULTI_ROLES: ключ расширен страной, поэтому «США» и «Канада»
        # уживаются, а два ментора на одну страну — нет. NULLS NOT DISTINCT
        # (Postgres 15+) нужен, чтобы и двух ответственных без страны индекс
        # считал дублем: иначе «несколько менторов по стране» молча означало бы
        # «сколько угодно безымянных строк».
        Index(
            "uq_mentor_assignment_active_country",
            "student_id",
            "role",
            "country_scope",
            unique=True,
            postgresql_nulls_not_distinct=True,
            postgresql_where=text(
                "is_active AND mentor_id IS NOT NULL AND role = 'country'"
            ),
        ),
    )

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
