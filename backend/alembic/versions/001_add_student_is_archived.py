"""Add is_archived column to students

Revision ID: 001
Revises:
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa

revision = '001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'students',
        sa.Column('is_archived', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade() -> None:
    op.drop_column('students', 'is_archived')
