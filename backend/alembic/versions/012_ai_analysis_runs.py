"""AI analysis runs audit trail

Revision ID: 012
Revises: 011
Create Date: 2026-07-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_analysis_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_type", sa.String(80), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column(
            "source_last_message_id",
            sa.Uuid(),
            sa.ForeignKey("telegram_messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(40), nullable=False, server_default="draft_created"),
        sa.Column("prompt_version", sa.String(80), nullable=False),
        sa.Column("model", sa.String(120), nullable=True),
        sa.Column("input_snapshot", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("raw_output", sa.Text(), nullable=True),
        sa.Column("parsed_output", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("filter_reasons", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_analysis_runs_source_type", "ai_analysis_runs", ["source_type"])
    op.create_index("ix_ai_analysis_runs_source_id", "ai_analysis_runs", ["source_id"])
    op.create_index("ix_ai_analysis_runs_student_id", "ai_analysis_runs", ["student_id"])
    op.create_index("ix_ai_analysis_runs_source_last_message_id", "ai_analysis_runs", ["source_last_message_id"])
    op.create_index("ix_ai_analysis_runs_status", "ai_analysis_runs", ["status"])
    op.create_index(
        "ix_ai_analysis_runs_source_status",
        "ai_analysis_runs",
        ["source_type", "source_id", "status", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_analysis_runs_source_status", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_status", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_source_last_message_id", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_student_id", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_source_id", table_name="ai_analysis_runs")
    op.drop_index("ix_ai_analysis_runs_source_type", table_name="ai_analysis_runs")
    op.drop_table("ai_analysis_runs")
