"""Add agreement_published/agreement_signed to audit_action enum.

ALTER TYPE ... ADD VALUE cannot run inside a transaction — autocommit block
(see 013_student_portal_access.py for the established pattern).

Revision ID: 049
Revises: 048
Create Date: 2026-08-03
"""
from alembic import op


revision = "049"
down_revision = "048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'agreement_published'")
        op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'agreement_signed'")


def downgrade() -> None:
    # Postgres cannot drop an enum value without recreating the type; not reverted.
    pass
