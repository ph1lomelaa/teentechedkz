"""Track stable Google Sheets row identity and staging revisions.

Revision ID: 112
Revises: 111
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "112"
down_revision = "111"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("intake_submissions", sa.Column("source_key", sa.String(500), nullable=True))
    op.add_column("intake_submissions", sa.Column("content_hash", sa.String(64), nullable=True))
    op.add_column("intake_submissions", sa.Column("content_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "intake_submissions",
        sa.Column("content_revision", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("intake_submissions", sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("intake_submissions", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE intake_submissions SET first_seen_at = created_at WHERE first_seen_at IS NULL")
    op.execute("UPDATE intake_submissions SET last_seen_at = created_at WHERE last_seen_at IS NULL")
    op.execute("UPDATE intake_submissions SET content_changed_at = created_at WHERE content_changed_at IS NULL")
    op.add_column(
        "intake_submissions",
        sa.Column("identity_review_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "intake_submissions",
        sa.Column("match_candidate_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False,
                  server_default=sa.text("'[]'::jsonb")),
    )
    op.create_unique_constraint(
        "uq_intake_submissions_source_key", "intake_submissions", ["source_key"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_intake_submissions_source_key", "intake_submissions", type_="unique")
    op.drop_column("intake_submissions", "match_candidate_ids")
    op.drop_column("intake_submissions", "identity_review_required")
    op.drop_column("intake_submissions", "last_seen_at")
    op.drop_column("intake_submissions", "first_seen_at")
    op.drop_column("intake_submissions", "content_changed_at")
    op.drop_column("intake_submissions", "content_revision")
    op.drop_column("intake_submissions", "content_hash")
    op.drop_column("intake_submissions", "source_key")
