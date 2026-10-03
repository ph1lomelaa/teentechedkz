"""Shared activity catalogue and individual participation; dates belong to intakes."""
import uuid
from datetime import date, datetime, timezone
from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class Activity(Base):
    __tablename__ = 'activities'
    __table_args__ = (CheckConstraint("publication IN ('draft','published','archived')", name='ck_activity_publication'),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    import_key: Mapped[str | None] = mapped_column(String(64), unique=True)
    import_source: Mapped[dict | None] = mapped_column(JSON)
    title: Mapped[str] = mapped_column(String(500))
    direction: Mapped[str | None] = mapped_column(String(255))
    kind: Mapped[str | None] = mapped_column(String(100))
    organizer: Mapped[str | None] = mapped_column(String(500))
    country: Mapped[str | None] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    eligibility: Mapped[str | None] = mapped_column(Text)
    assignment: Mapped[str | None] = mapped_column(Text)
    source_url: Mapped[str | None] = mapped_column(String(2048))
    publication: Mapped[str] = mapped_column(String(20), default='draft', server_default='draft')
    # Когда команда последний раз сверяла условия с сайтом организатора. Пусто —
    # не сверяли; ученику так и пишем, а не подставляем дату создания.
    conditions_checked_at: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

class ActivityIntake(Base):
    __tablename__ = 'activity_intakes'
    __table_args__ = (
        CheckConstraint("mode IN ('fixed','rolling','self_paced','unknown')", name='ck_intake_mode'),
        CheckConstraint("cost_state IN ('free','paid','unknown')", name='ck_intake_cost'),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('activities.id', ondelete='RESTRICT'), index=True)
    label: Mapped[str] = mapped_column(String(255))
    mode: Mapped[str] = mapped_column(String(20), default='unknown', server_default='unknown')
    deadline: Mapped[date | None] = mapped_column(Date)
    dates_text: Mapped[str | None] = mapped_column(Text)
    format: Mapped[str | None] = mapped_column(String(100))
    cost_state: Mapped[str] = mapped_column(String(20), default='unknown', server_default='unknown')
    cost_text: Mapped[str | None] = mapped_column(String(500))

class StudentActivity(Base):
    __tablename__ = 'student_activities'
    __table_args__ = (
        UniqueConstraint('student_id', 'intake_id', name='uq_student_activity_intake'),
        CheckConstraint("decision IN ('suggested','selected','not_interested')", name='ck_participation_decision'),
        CheckConstraint("status IN ('not_started','in_progress','submitted','completed','cancelled')", name='ck_participation_status'),
    )
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('students.id', ondelete='CASCADE'), index=True)
    intake_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('activity_intakes.id', ondelete='RESTRICT'), index=True)
    selection_source: Mapped[str] = mapped_column(String(20), default='unknown', server_default='unknown')
    selected_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    mentor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'))
    decision: Mapped[str] = mapped_column(String(20), default='selected', server_default='selected')
    status: Mapped[str] = mapped_column(String(20), default='not_started', server_default='not_started')
    goal: Mapped[str | None] = mapped_column(Text)
    # Причина рекомендации от ментора — её видит ученик. Цель (goal) — слова
    # самого ученика, поэтому поля разные и друг друга не подменяют.
    recommendation_note: Mapped[str | None] = mapped_column(Text)
    # Личный срок ученика. Дедлайн организатора живёт в наборе и сюда не копируется.
    personal_deadline: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
