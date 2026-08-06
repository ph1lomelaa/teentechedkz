"""Add original task deadline and contract type for mentor regulation.

Revision ID: 074
Revises: 073
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "074"
down_revision = "073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_tasks",
        sa.Column("original_due_date", sa.Date(), nullable=True),
    )
    op.execute(
        "UPDATE student_tasks SET original_due_date = due_date "
        "WHERE due_date IS NOT NULL AND original_due_date IS NULL"
    )
    op.add_column(
        "contracts",
        sa.Column("contract_type", sa.String(length=20), server_default="civil", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("contracts", "contract_type")
    op.drop_column("student_tasks", "original_due_date")
