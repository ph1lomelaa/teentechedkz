"""Add task result, acceptance and priority fields.

Revision ID: 070
Revises: 069
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "070"
down_revision = "069"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_tasks", sa.Column("expected_result", sa.Text(), nullable=True))
    op.add_column("student_tasks", sa.Column("acceptance_criteria", sa.Text(), nullable=True))
    op.add_column("student_tasks", sa.Column("required_documents", sa.JSON(), nullable=True))
    op.add_column(
        "student_tasks",
        sa.Column("priority", sa.String(length=20), nullable=False, server_default="normal"),
    )


def downgrade() -> None:
    op.drop_column("student_tasks", "priority")
    op.drop_column("student_tasks", "required_documents")
    op.drop_column("student_tasks", "acceptance_criteria")
    op.drop_column("student_tasks", "expected_result")
