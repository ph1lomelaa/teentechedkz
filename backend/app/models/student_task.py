import uuid
from datetime import datetime, timezone
from sqlalchemy import Text, DateTime, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
import enum


class TaskStatus(str, enum.Enum):
    open = "open"
    done = "done"


class StudentTask(Base):
    __tablename__ = "student_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"))
    task_text: Mapped[str] = mapped_column(Text)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus, name="task_status"), default=TaskStatus.open)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["Student"] = relationship(back_populates="student_tasks")
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
