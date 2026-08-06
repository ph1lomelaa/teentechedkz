"""Allow unfilled required team assignments.

Revision ID: 081
Revises: 080
"""

from alembic import op


revision = "081"
down_revision = "080"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("mentor_assignments", "mentor_id", nullable=True)


def downgrade() -> None:
    op.alter_column("mentor_assignments", "mentor_id", nullable=False)