"""Preserve the Notion reapplication pipeline status."""

from alembic import op

revision = "108"
down_revision = "107"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE pipeline_status ADD VALUE IF NOT EXISTS 'reapplication'")


def downgrade() -> None:
    # Removing a PostgreSQL enum value can invalidate existing contracts.
    pass
