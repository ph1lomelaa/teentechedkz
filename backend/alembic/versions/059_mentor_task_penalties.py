"""Реестр финансовых санкций ментора по цветам (регламент менторов, раздел 6).

Revision ID: 059
Revises: 058
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "059"
down_revision = "058"
branch_labels = None
depends_on = None


def upgrade() -> None:
    penalty_color = postgresql.ENUM("yellow", "orange", "red", name="penalty_color", create_type=False)
    penalty_color.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "mentor_task_penalties",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("mentor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("student_tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("color", penalty_color, nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("contested", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("contest_note", sa.Text(), nullable=True),
    )
    op.create_index("ix_mentor_task_penalties_mentor_id", "mentor_task_penalties", ["mentor_id"])


def downgrade() -> None:
    op.drop_index("ix_mentor_task_penalties_mentor_id", table_name="mentor_task_penalties")
    op.drop_table("mentor_task_penalties")
    sa.Enum(name="penalty_color").drop(op.get_bind(), checkfirst=True)
