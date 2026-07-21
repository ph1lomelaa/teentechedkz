"""Personal Telegram invite links + student telegram identity (Приоритет 4).

Revision ID: 031
Revises: 030
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "031"
down_revision = "030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("students", sa.Column("telegram_user_id", sa.String(length=100), nullable=True))
    op.add_column("students", sa.Column("telegram_username", sa.String(length=150), nullable=True))
    op.add_column("students", sa.Column("telegram_linked_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_students_telegram_user_id", "students", ["telegram_user_id"])

    op.create_table(
        "telegram_invite_links",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("tg_chat_id", sa.BigInteger(), nullable=False),
        sa.Column("invite_link", sa.String(length=512), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("joined_tg_user_id", sa.String(length=100), nullable=True),
        sa.Column("joined_username", sa.String(length=150), nullable=True),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_telegram_invite_links_student_id", "telegram_invite_links", ["student_id"])
    op.create_index("ix_telegram_invite_links_tg_chat_id", "telegram_invite_links", ["tg_chat_id"])
    op.create_index("ix_telegram_invite_links_invite_link", "telegram_invite_links", ["invite_link"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_telegram_invite_links_invite_link", table_name="telegram_invite_links")
    op.drop_index("ix_telegram_invite_links_tg_chat_id", table_name="telegram_invite_links")
    op.drop_index("ix_telegram_invite_links_student_id", table_name="telegram_invite_links")
    op.drop_table("telegram_invite_links")
    op.drop_index("ix_students_telegram_user_id", table_name="students")
    op.drop_column("students", "telegram_linked_at")
    op.drop_column("students", "telegram_username")
    op.drop_column("students", "telegram_user_id")
