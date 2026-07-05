"""Store the original filename for Telegram attachments

Revision ID: 009
Revises: 008
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("telegram_attachments", sa.Column("file_name", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("telegram_attachments", "file_name")
