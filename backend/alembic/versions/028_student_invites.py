"""Student invite links + invite audit actions (Приоритет 1).

Revision ID: 028
Revises: 027
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # New audit actions (Postgres 12+ allows ADD VALUE inside a transaction as
    # long as the value isn't used in the same transaction).
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invite_created'")
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'invite_accepted'")

    op.create_table(
        "student_invites",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_student_invites_user_id", "student_invites", ["user_id"])
    op.create_index("ix_student_invites_student_id", "student_invites", ["student_id"])
    op.create_index("ix_student_invites_token_hash", "student_invites", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_student_invites_token_hash", table_name="student_invites")
    op.drop_index("ix_student_invites_student_id", table_name="student_invites")
    op.drop_index("ix_student_invites_user_id", table_name="student_invites")
    op.drop_table("student_invites")
    # Enum values are intentionally left in place — Postgres can't drop a single
    # enum value without recreating the type.
