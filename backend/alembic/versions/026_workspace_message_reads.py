"""Workspace message read state and outbound Telegram attribution.

Revision ID: 026
Revises: 025
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "026"
down_revision = "025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_message_reads",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("telegram_last_read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "student_id"),
    )
    op.alter_column("telegram_messages", "update_id", existing_type=sa.BigInteger(), nullable=True)
    op.add_column("telegram_messages", sa.Column("sent_by_user_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_telegram_messages_sent_by_user",
        "telegram_messages",
        "users",
        ["sent_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_telegram_messages_sent_by_user_id", "telegram_messages", ["sent_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_telegram_messages_sent_by_user_id", table_name="telegram_messages")
    op.drop_constraint("fk_telegram_messages_sent_by_user", "telegram_messages", type_="foreignkey")
    op.drop_column("telegram_messages", "sent_by_user_id")
    op.alter_column("telegram_messages", "update_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_table("workspace_message_reads")
