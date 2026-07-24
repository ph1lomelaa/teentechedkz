"""Add background_jobs table for persisted Notion sync/import job state

Revision ID: 041
Revises: 040
Create Date: 2026-07-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "041"
down_revision = "040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "background_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(60), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("request", postgresql.JSONB, nullable=True),
        sa.Column("progress", postgresql.JSONB, nullable=True),
        sa.Column("events", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("result", postgresql.JSONB, nullable=True),
        sa.Column("error", sa.Text, nullable=True),
    )
    op.create_index("ix_background_jobs_kind", "background_jobs", ["kind"])
    op.create_index("ix_background_jobs_status", "background_jobs", ["status"])
    op.create_index("ix_background_jobs_kind_status", "background_jobs", ["kind", "status"])


def downgrade() -> None:
    op.drop_index("ix_background_jobs_kind_status", table_name="background_jobs")
    op.drop_index("ix_background_jobs_status", table_name="background_jobs")
    op.drop_index("ix_background_jobs_kind", table_name="background_jobs")
    op.drop_table("background_jobs")
