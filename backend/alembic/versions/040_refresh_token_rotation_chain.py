"""Add replaced_by_hash to refresh_tokens for rotation grace period

Revision ID: 040
Revises: 039
Create Date: 2026-07-24
"""
from alembic import op
import sqlalchemy as sa

revision = "040"
down_revision = "039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("refresh_tokens", sa.Column("replaced_by_hash", sa.String(255), nullable=True))
    op.add_column("refresh_tokens", sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("refresh_tokens", "revoked_at")
    op.drop_column("refresh_tokens", "replaced_by_hash")
