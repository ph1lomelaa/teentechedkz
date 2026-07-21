"""Confidential note visible to student (portal «Заметки» section).

Revision ID: 035
Revises: 034
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "035"
down_revision = "034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "confidential_notes",
        sa.Column("visible_to_student", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("confidential_notes", "visible_to_student")
