"""Meeting bot: bot fields and quality check on note sessions, Zoom connection on users, bot event log.

Revision ID: 101
Revises: 100
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "101"
down_revision = "100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("note_sessions", sa.Column("meeting_url", sa.String(2048), nullable=True))
    op.add_column("note_sessions", sa.Column("bot_provider", sa.String(32), nullable=True))
    op.add_column("note_sessions", sa.Column("bot_external_id", sa.String(128), nullable=True))
    op.create_unique_constraint("note_sessions_bot_external_id_key", "note_sessions", ["bot_external_id"])
    op.add_column("note_sessions", sa.Column("bot_status", sa.String(32), nullable=True))
    op.add_column("note_sessions", sa.Column("bot_status_reason", sa.String(64), nullable=True))
    op.add_column("note_sessions", sa.Column("bot_last_event_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("note_sessions", sa.Column("bot_joined_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("note_sessions", sa.Column("audio_storage_path", sa.String(2048), nullable=True))
    op.add_column("note_sessions", sa.Column("quality", sa.String(16), nullable=True))
    op.add_column(
        "note_sessions",
        sa.Column("quality_reasons", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "note_sessions",
        sa.Column("quality_warnings", postgresql.JSONB(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "note_sessions",
        sa.Column("quality_metrics", postgresql.JSONB(), nullable=False, server_default="{}"),
    )

    op.add_column("users", sa.Column("zoom_connection_id", sa.String(128), nullable=True))
    op.add_column("users", sa.Column("zoom_user_id", sa.String(128), nullable=True))
    op.add_column("users", sa.Column("zoom_connection_state", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("zoom_connected_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "meeting_bot_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("idempotency_key", sa.String(128), nullable=False, unique=True),
        sa.Column(
            "session_id",
            sa.Uuid(),
            sa.ForeignKey("note_sessions.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("trigger", sa.String(64), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_meeting_bot_events_session_id", "meeting_bot_events", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_meeting_bot_events_session_id", table_name="meeting_bot_events")
    op.drop_table("meeting_bot_events")
    for column in ("zoom_connected_at", "zoom_connection_state", "zoom_user_id", "zoom_connection_id"):
        op.drop_column("users", column)
    op.drop_constraint("note_sessions_bot_external_id_key", "note_sessions", type_="unique")
    for column in (
        "quality_metrics",
        "quality_warnings",
        "quality_reasons",
        "quality",
        "audio_storage_path",
        "bot_joined_at",
        "bot_last_event_at",
        "bot_status_reason",
        "bot_status",
        "bot_external_id",
        "bot_provider",
        "meeting_url",
    ):
        op.drop_column("note_sessions", column)
