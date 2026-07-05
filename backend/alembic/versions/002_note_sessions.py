"""Add note sessions and transcripts

Revision ID: 002
Revises: 001
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


note_session_status = sa.Enum("active", "completed", "cancelled", name="note_session_status")


def upgrade() -> None:
    bind = op.get_bind()
    note_session_status.create(bind, checkfirst=True)

    op.create_table(
        "note_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("note_id", sa.Uuid(), sa.ForeignKey("student_notes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("status", note_session_status, nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_note_sessions_student_id", "note_sessions", ["student_id"])
    op.create_index("ix_note_sessions_note_id", "note_sessions", ["note_id"])

    op.create_table(
        "note_transcripts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("session_id", sa.Uuid(), sa.ForeignKey("note_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("speaker", sa.Text(), nullable=True),
        sa.Column("client_segment_id", sa.Text(), nullable=True),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_note_transcripts_session_id", "note_transcripts", ["session_id"])
    op.create_index("ix_note_transcripts_session_sequence", "note_transcripts", ["session_id", "sequence_no"], unique=True)
    op.create_index("ix_note_transcripts_session_client_segment", "note_transcripts", ["session_id", "client_segment_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_note_transcripts_session_client_segment", table_name="note_transcripts")
    op.drop_index("ix_note_transcripts_session_sequence", table_name="note_transcripts")
    op.drop_index("ix_note_transcripts_session_id", table_name="note_transcripts")
    op.drop_table("note_transcripts")
    op.drop_index("ix_note_sessions_note_id", table_name="note_sessions")
    op.drop_index("ix_note_sessions_student_id", table_name="note_sessions")
    op.drop_table("note_sessions")
    bind = op.get_bind()
    note_session_status.drop(bind, checkfirst=True)
