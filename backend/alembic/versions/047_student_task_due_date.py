"""Add due_date to student_tasks — foundation for task urgency (Block B, ОС 30/07).

due_date is assigned by admin (Академ Хэд) only; due_date_set_by records who set it,
for audit. RoadmapTask already has due_date (see roadmap.py) — StudentTask did not.

Revision ID: 047
Revises: 046
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa


revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_tasks", sa.Column("due_date", sa.Date(), nullable=True))
    op.add_column("student_tasks", sa.Column("due_date_set_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_student_tasks_due_date_set_by",
        "student_tasks",
        "users",
        ["due_date_set_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_student_tasks_due_date",
        "student_tasks",
        ["due_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_student_tasks_due_date", table_name="student_tasks")
    op.drop_constraint("fk_student_tasks_due_date_set_by", "student_tasks", type_="foreignkey")
    op.drop_column("student_tasks", "due_date_set_by")
    op.drop_column("student_tasks", "due_date")
