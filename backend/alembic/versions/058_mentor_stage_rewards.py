"""Вознаграждение ментора по этапам — ПИЛОТ (регламент менторов, разделы 6-8).

Только расчёт/отображение, не связано с реальной выплатой.

Revision ID: 058
Revises: 057
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "058"
down_revision = "057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    mentor_stage_kind = sa.Enum("pre_admission", "admission", "post_admission", name="mentor_stage_kind")
    mentor_stage_kind.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "mentor_stage_rewards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mentor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("stage", mentor_stage_kind, nullable=False),
        sa.Column("total_contract_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("computed_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("accepted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("accepted_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("student_id", "mentor_id", "stage", name="uq_mentor_stage_rewards_stage"),
    )
    op.create_index("ix_mentor_stage_rewards_student_id", "mentor_stage_rewards", ["student_id"])
    op.create_index("ix_mentor_stage_rewards_mentor_id", "mentor_stage_rewards", ["mentor_id"])


def downgrade() -> None:
    op.drop_index("ix_mentor_stage_rewards_mentor_id", table_name="mentor_stage_rewards")
    op.drop_index("ix_mentor_stage_rewards_student_id", table_name="mentor_stage_rewards")
    op.drop_table("mentor_stage_rewards")
    sa.Enum(name="mentor_stage_kind").drop(op.get_bind(), checkfirst=True)
