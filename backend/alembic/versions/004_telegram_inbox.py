"""Telegram client inbox: chats, sessions, messages, attachments

Revision ID: 004
Revises: 003
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


telegram_chat_type = sa.Enum("private", "group", "supergroup", name="telegram_chat_type")
telegram_chat_status = sa.Enum("unbound", "active", "paused", "closed", name="telegram_chat_status")
telegram_session_status = sa.Enum("active", "closed", name="telegram_session_status")
telegram_message_type = sa.Enum(
    "text", "photo", "document", "voice", "video_note", "other", name="telegram_message_type"
)
telegram_attachment_status = sa.Enum(
    "pending", "downloaded", "parsed", "failed", name="telegram_attachment_status"
)


def upgrade() -> None:
    bind = op.get_bind()
    telegram_chat_type.create(bind, checkfirst=True)
    telegram_chat_status.create(bind, checkfirst=True)
    telegram_session_status.create(bind, checkfirst=True)
    telegram_message_type.create(bind, checkfirst=True)
    telegram_attachment_status.create(bind, checkfirst=True)

    op.create_table(
        "telegram_chats",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("chat_type", telegram_chat_type, nullable=False),
        sa.Column("title", sa.String(500), nullable=True),
        sa.Column("privacy_mode_disabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("status", telegram_chat_status, nullable=False, server_default="unbound"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_telegram_chats_chat_id", "telegram_chats", ["chat_id"])

    op.create_table(
        "telegram_chat_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("chat_id", sa.Uuid(), sa.ForeignKey("telegram_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", telegram_session_status, nullable=False, server_default="active"),
        sa.Column("opened_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_telegram_chat_sessions_chat_id", "telegram_chat_sessions", ["chat_id"])
    op.create_index("ix_telegram_chat_sessions_student_id", "telegram_chat_sessions", ["student_id"])

    op.create_table(
        "telegram_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("chat_id", sa.Uuid(), sa.ForeignKey("telegram_chats.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "session_id", sa.Uuid(), sa.ForeignKey("telegram_chat_sessions.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("telegram_message_id", sa.BigInteger(), nullable=False),
        sa.Column("update_id", sa.BigInteger(), nullable=False, unique=True),
        sa.Column("sender_tg_id", sa.BigInteger(), nullable=True),
        sa.Column("sender_name", sa.Text(), nullable=True),
        sa.Column("message_type", telegram_message_type, nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("raw_payload", JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_telegram_messages_chat_id", "telegram_messages", ["chat_id"])
    op.create_index("ix_telegram_messages_session_id", "telegram_messages", ["session_id"])
    op.create_index("ix_telegram_messages_update_id", "telegram_messages", ["update_id"])

    op.create_table(
        "telegram_attachments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "message_id", sa.Uuid(), sa.ForeignKey("telegram_messages.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("telegram_file_id", sa.String(500), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("storage_path", sa.String(2048), nullable=True),
        sa.Column("status", telegram_attachment_status, nullable=False, server_default="pending"),
        sa.Column("parsed_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_telegram_attachments_message_id", "telegram_attachments", ["message_id"])

    op.add_column(
        "pending_insights",
        sa.Column(
            "source_telegram_message_id", sa.Uuid(), sa.ForeignKey("telegram_messages.id"), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("pending_insights", "source_telegram_message_id")

    op.drop_index("ix_telegram_attachments_message_id", table_name="telegram_attachments")
    op.drop_table("telegram_attachments")

    op.drop_index("ix_telegram_messages_update_id", table_name="telegram_messages")
    op.drop_index("ix_telegram_messages_session_id", table_name="telegram_messages")
    op.drop_index("ix_telegram_messages_chat_id", table_name="telegram_messages")
    op.drop_table("telegram_messages")

    op.drop_index("ix_telegram_chat_sessions_student_id", table_name="telegram_chat_sessions")
    op.drop_index("ix_telegram_chat_sessions_chat_id", table_name="telegram_chat_sessions")
    op.drop_table("telegram_chat_sessions")

    op.drop_index("ix_telegram_chats_chat_id", table_name="telegram_chats")
    op.drop_table("telegram_chats")

    bind = op.get_bind()
    telegram_attachment_status.drop(bind, checkfirst=True)
    telegram_message_type.drop(bind, checkfirst=True)
    telegram_session_status.drop(bind, checkfirst=True)
    telegram_chat_status.drop(bind, checkfirst=True)
    telegram_chat_type.drop(bind, checkfirst=True)
