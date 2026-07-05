"""Capture AI-proposed fields that don't map to any student profile field

Revision ID: 006
Revises: 005
Create Date: 2026-07-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "pending_insights",
        sa.Column("unmatched_fields", postgresql.JSONB(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("pending_insights", "unmatched_fields")
