"""Add synced_baseline to notion_snapshots for two-way sync direction tracking

Revision ID: 044
Revises: 043
Create Date: 2026-07-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "044"
down_revision = "043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notion_snapshots",
        sa.Column("synced_baseline", postgresql.JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("notion_snapshots", "synced_baseline")
