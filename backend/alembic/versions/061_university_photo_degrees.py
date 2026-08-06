"""University: photo_url, degree_levels, source refs — for real catalog import (Tilda + Sheets).

Revision ID: 061
Revises: 060
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "061"
down_revision = "060"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("universities", sa.Column("photo_url", sa.String(length=1000), nullable=True))
    op.add_column("universities", sa.Column("degree_levels", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("universities", sa.Column("source_tilda_url", sa.String(length=1000), nullable=True))
    op.add_column("universities", sa.Column("source_sheet_row_ref", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("universities", "source_sheet_row_ref")
    op.drop_column("universities", "source_tilda_url")
    op.drop_column("universities", "degree_levels")
    op.drop_column("universities", "photo_url")
