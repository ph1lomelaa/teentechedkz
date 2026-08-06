"""Mentor role: country (ментор по стране), per регламент МЗК.

ALTER TYPE ... ADD VALUE cannot run inside a transaction — autocommit block,
same pattern as 013_student_portal_access.py.

Revision ID: 052
Revises: 051
Create Date: 2026-08-04
"""
from alembic import op

revision = "052"
down_revision = "051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE mentor_role ADD VALUE IF NOT EXISTS 'country'")


def downgrade() -> None:
    # Postgres cannot drop an enum value without recreating the type.
    pass
