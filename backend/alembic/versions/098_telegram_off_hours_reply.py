"""Persist Telegram off-hours reply cooldown.

Revision ID: 098
Revises: 097
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa


revision = "098"
down_revision = "097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "telegram_chats",
        sa.Column("last_off_hours_reply_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("telegram_chats", "last_off_hours_reply_at")
