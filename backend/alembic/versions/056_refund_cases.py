"""Возвратные кейсы (регламент МЗК, раздел 6) — ручной уровень сложности, без SLA.

Revision ID: 056
Revises: 055
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "056"
down_revision = "055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    refund_level = sa.Enum("yellow", "orange", "red", name="refund_level")
    refund_case_status = sa.Enum("open", "resolved", "rejected", name="refund_case_status")
    refund_level.create(op.get_bind(), checkfirst=True)
    refund_case_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "refund_cases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("contract_id", sa.Uuid(), sa.ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("mzk_manager_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("level", refund_level, nullable=True),
        sa.Column("level_approved_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("level_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", refund_case_status, nullable=False, server_default="open"),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_refund_cases_student_id", "refund_cases", ["student_id"])
    op.create_index("ix_refund_cases_mzk_manager_id", "refund_cases", ["mzk_manager_id"])


def downgrade() -> None:
    op.drop_index("ix_refund_cases_mzk_manager_id", table_name="refund_cases")
    op.drop_index("ix_refund_cases_student_id", table_name="refund_cases")
    op.drop_table("refund_cases")
    sa.Enum(name="refund_case_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="refund_level").drop(op.get_bind(), checkfirst=True)
