"""Флаг ручной отвязки Notion-записи: автосинк не привязывает обратно

Revision ID: 011
Revises: 010
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notion_snapshots",
        sa.Column("manual_unlink", sa.Boolean, nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("notion_snapshots", "manual_unlink")
