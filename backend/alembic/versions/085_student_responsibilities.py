"""Зоны ответственности: кто ведёт какой участок у конкретного ученика.

Revision ID: 085
Revises: 084
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa

revision = "085"
down_revision = "084"
branch_labels = None
depends_on = None


AREAS = (
    "meetings",
    "telegram",
    "notes",
    "tasks",
    "roadmap",
    "documents",
    "portfolio",
    "applications",
    "questionnaires",
    "finance",
)


def upgrade() -> None:
    area = sa.Enum(*AREAS, name="responsibility_area")
    area.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "student_responsibilities",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("student_id", sa.UUID(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("area", area, nullable=False),
        sa.Column("user_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assigned_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("note", sa.String(length=500), nullable=True),
        # Один ответственный на зону: «кто ведёт встречи» обязано иметь ровно
        # один ответ, иначе таблица не решает ту путаницу, ради которой заведена.
        sa.UniqueConstraint("student_id", "area", name="uq_student_responsibility_area"),
    )
    op.create_index("ix_student_responsibilities_student_id", "student_responsibilities", ["student_id"])
    # Запрос «за что я отвечаю» идёт по пользователю и должен быть дешёвым: он
    # выполняется на каждом открытии «Моего дня».
    op.create_index("ix_student_responsibilities_user_id", "student_responsibilities", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_student_responsibilities_user_id", table_name="student_responsibilities")
    op.drop_index("ix_student_responsibilities_student_id", table_name="student_responsibilities")
    op.drop_table("student_responsibilities")
    sa.Enum(name="responsibility_area").drop(op.get_bind(), checkfirst=True)
