"""documents.visible_to_student — student portal visibility flag

Revision ID: 017
Revises: 016
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("visible_to_student", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("documents", "visible_to_student")
