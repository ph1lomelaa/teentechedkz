"""Important student notes and their origin.

Revision ID: 033
Revises: 032
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_notes", sa.Column("is_important", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("student_notes", sa.Column("source_kind", sa.String(length=30), nullable=False, server_default="manual"))


def downgrade() -> None:
    op.drop_column("student_notes", "source_kind")
    op.drop_column("student_notes", "is_important")
