"""Cached AI verdicts for intake reconciliation mismatches

Revision ID: 008
Revises: 007
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "intake_ai_checks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("field", sa.String(100), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("same_meaning", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_intake_ai_checks_lookup",
        "intake_ai_checks",
        ["student_id", "field", "content_hash"],
        unique=True,
    )
    op.create_index("ix_intake_ai_checks_student_id", "intake_ai_checks", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_intake_ai_checks_student_id", table_name="intake_ai_checks")
    op.drop_index("ix_intake_ai_checks_lookup", table_name="intake_ai_checks")
    op.drop_table("intake_ai_checks")
