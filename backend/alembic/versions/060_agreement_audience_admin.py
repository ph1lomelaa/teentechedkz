"""AgreementAudience.admin — регламенты для Академ Хэда / Хэда МЗК (оба = admin), без принудительной подписи.

Revision ID: 060
Revises: 059
Create Date: 2026-08-04
"""
from alembic import op

revision = "060"
down_revision = "059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE agreement_audience ADD VALUE IF NOT EXISTS 'admin'")


def downgrade() -> None:
    pass
