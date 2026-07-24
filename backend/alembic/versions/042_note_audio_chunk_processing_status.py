"""Add 'processing' value to note_audio_chunk_status enum

Revision ID: 042
Revises: 041
Create Date: 2026-07-24
"""
from alembic import op

revision = "042"
down_revision = "041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE note_audio_chunk_status ADD VALUE IF NOT EXISTS 'processing'")


def downgrade() -> None:
    # Postgres doesn't support removing enum values; no-op.
    pass
