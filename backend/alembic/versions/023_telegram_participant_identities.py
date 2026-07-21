"""Map Telegram participants to workspace users.

Revision ID: 023
Revises: 022
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_participant_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("chat_id", sa.Uuid(), nullable=False),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("student_id", sa.Uuid(), nullable=True),
        sa.Column("role", sa.String(40), nullable=False, server_default="unknown"),
        sa.Column("display_name", sa.String(300), nullable=True),
        sa.Column("confirmed_by", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["telegram_chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["confirmed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "telegram_user_id", name="uq_telegram_participant_chat_user"),
    )
    op.create_index("ix_telegram_participant_identities_chat_id", "telegram_participant_identities", ["chat_id"])
    op.create_index("ix_telegram_participant_identities_telegram_user_id", "telegram_participant_identities", ["telegram_user_id"])
    op.create_index("ix_telegram_participant_identities_user_id", "telegram_participant_identities", ["user_id"])
    op.create_index("ix_telegram_participant_identities_student_id", "telegram_participant_identities", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_telegram_participant_identities_student_id", table_name="telegram_participant_identities")
    op.drop_index("ix_telegram_participant_identities_user_id", table_name="telegram_participant_identities")
    op.drop_index("ix_telegram_participant_identities_telegram_user_id", table_name="telegram_participant_identities")
    op.drop_index("ix_telegram_participant_identities_chat_id", table_name="telegram_participant_identities")
    op.drop_table("telegram_participant_identities")
