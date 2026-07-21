"""Notification priority.

Revision ID: 034
Revises: 033
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "034"
down_revision = "033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("priority", sa.String(length=16), nullable=False, server_default="normal"))


def downgrade() -> None:
    op.drop_column("notifications", "priority")
