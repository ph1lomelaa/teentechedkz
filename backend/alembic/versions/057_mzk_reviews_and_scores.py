"""ОКК МЗК: mzk_reviews + mzk_quality_scores (регламент МЗК, раздел 7).

Revision ID: 057
Revises: 056
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "057"
down_revision = "056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mzk_reviews",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("mzk_manager_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_year", sa.Integer(), nullable=False),
        sa.Column("period_month", sa.Integer(), nullable=False),
        sa.Column("is_positive", sa.Boolean(), nullable=False),
        sa.Column("is_valid", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("invalidated_reason", sa.String(length=500), nullable=True),
        sa.Column("source_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mzk_reviews_mzk_manager_id", "mzk_reviews", ["mzk_manager_id"])

    op.create_table(
        "mzk_quality_scores",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("mzk_manager_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_year", sa.Integer(), nullable=False),
        sa.Column("period_month", sa.Integer(), nullable=False),
        sa.Column("valid_reviews_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("positive_reviews_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("bonus_amount", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("disqualified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("disqualified_reason", sa.String(length=500), nullable=True),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("mzk_manager_id", "period_year", "period_month", name="uq_mzk_quality_scores_period"),
    )
    op.create_index("ix_mzk_quality_scores_mzk_manager_id", "mzk_quality_scores", ["mzk_manager_id"])


def downgrade() -> None:
    op.drop_index("ix_mzk_quality_scores_mzk_manager_id", table_name="mzk_quality_scores")
    op.drop_table("mzk_quality_scores")
    op.drop_index("ix_mzk_reviews_mzk_manager_id", table_name="mzk_reviews")
    op.drop_table("mzk_reviews")
