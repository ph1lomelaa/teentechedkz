"""Кто за что отвечает у конкретного ученика.

Зачем отдельная таблица
-----------------------
У ученика несколько менторов и МЗК, и до сих пор система не отвечала на вопрос
«кто ведёт встречи именно у него». Роль отвечает на другой вопрос — «кому вообще
можно», — и подменять одно другим нельзя.

Почему не поле в `mentor_assignments`, где уже есть `functional_zone`:

* `MentorAssignment.role` — это **специализация** (IELTS, SAT, виза,
  профориентация). Ментор по IELTS может вести встречи, а может не вести: зона
  работы ортогональна предмету.
* МЗК-менеджер вообще не имеет строки в `mentor_assignments` — он привязан к
  ученику через `contracts.mzk_manager_id`. Через ту таблицу зону ему не выдать
  в принципе.
* `functional_zone` — свободный текст. Он живёт в базе с миграции 071, пишется
  через API и **не показан ни на одном экране**: по строке нельзя ни посчитать
  покрытие, ни отфильтровать, ни подсветить. Ровно поэтому здесь перечисление.

Ответственность НЕ ограничивает доступ
--------------------------------------
Право открывает дверь, ответственность вешает на неё табличку с именем. Если
ответственный в отпуске, встречу проведёт любой, у кого есть право, — и в
интерфейсе будет видно, чей это вообще участок. Так устроены assignee в Jira и
CODEOWNERS в GitHub; системы, где «ответственный» ещё и запрещает, ломаются на
первом отпуске.
"""
import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SAEnum, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ResponsibilityArea(str, enum.Enum):
    """Участки работы с учеником. Перечисление, а не свободный текст.

    Порядок объявления — порядок показа на всех экранах.
    """

    meetings = "meetings"              # встречи со студентом
    telegram = "telegram"              # переписка и Telegram-канал
    notes = "notes"                    # конспекты и заметки
    tasks = "tasks"                    # задачи ученику
    roadmap = "roadmap"                # ведение roadmap
    documents = "documents"            # сбор и проверка документов
    portfolio = "portfolio"            # портфолио
    applications = "applications"      # заявки в вузы и шортлист
    questionnaires = "questionnaires"  # анкеты
    finance = "finance"                # договор и платежи


class StudentResponsibility(Base):
    __tablename__ = "student_responsibilities"
    __table_args__ = (
        # Один ответственный на зону: вопрос «кто ведёт встречи» обязан иметь
        # ровно один ответ, иначе таблица не решает исходную путаницу.
        UniqueConstraint("student_id", "area", name="uq_student_responsibility_area"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), index=True
    )
    area: Mapped[ResponsibilityArea] = mapped_column(
        SAEnum(ResponsibilityArea, name="responsibility_area")
    )
    # Ментор ИЛИ МЗК — любой сотрудник. Ограничение по роли живёт в эндпоинте,
    # а не в схеме: роль человека со временем меняется, а история — нет.
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    student: Mapped["Student"] = relationship(back_populates="responsibilities")
    user: Mapped["User"] = relationship(foreign_keys=[user_id])
