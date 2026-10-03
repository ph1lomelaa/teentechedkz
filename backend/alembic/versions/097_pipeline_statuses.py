"""Preserve distinct Notion payment pipeline statuses.

Revision ID: 097
Revises: 096
Create Date: 2026-09-30
"""
from alembic import op


revision = "097"
down_revision = "096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL enum values cannot be removed safely in a downgrade. Adding
    # them is idempotent so partially applied deploys can be retried.
    for value in ("completed_admitted", "lost_applicant", "problem"):
        op.execute(f"ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Keep enum labels: old application versions ignore them, while rebuilding
    # the enum risks invalidating existing contract rows.
    pass
