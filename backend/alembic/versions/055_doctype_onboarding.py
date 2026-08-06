"""DocType.onboarding — файл по онбордингу (регламент МЗК п.2.2, п.3.5-3.6).

Revision ID: 055
Revises: 054
Create Date: 2026-08-04
"""
from alembic import op

revision = "055"
down_revision = "054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE doc_type ADD VALUE IF NOT EXISTS 'onboarding'")


def downgrade() -> None:
    pass
