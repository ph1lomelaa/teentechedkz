"""Add student-facing reformulation of конспект summary.

Revision ID: 045
Revises: 044
Create Date: 2026-07-27
"""
from alembic import op
import sqlalchemy as sa

revision = "045"
down_revision = "044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_notes",
        sa.Column("student_summary_markdown", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("student_notes", "student_summary_markdown")
