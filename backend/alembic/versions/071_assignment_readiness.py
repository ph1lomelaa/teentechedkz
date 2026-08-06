"""Add readiness metadata to mentor assignments.

Revision ID: 071
Revises: 070
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "071"
down_revision = "070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("mentor_assignments", sa.Column("functional_zone", sa.String(length=500), nullable=True))
    op.add_column("mentor_assignments", sa.Column("first_task_due_date", sa.Date(), nullable=True))
    op.add_column(
        "mentor_assignments",
        sa.Column("assignment_status", sa.String(length=30), nullable=False, server_default="active"),
    )


def downgrade() -> None:
    op.drop_column("mentor_assignments", "assignment_status")
    op.drop_column("mentor_assignments", "first_task_due_date")
    op.drop_column("mentor_assignments", "functional_zone")
