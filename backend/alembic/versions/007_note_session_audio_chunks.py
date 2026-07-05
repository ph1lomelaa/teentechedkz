"""Local audio-recording safety net for note sessions

Revision ID: 007
Revises: 006
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("note_sessions", sa.Column("backup_transcript_text", sa.Text(), nullable=True))

    op.create_table(
        "note_session_audio_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "session_id", sa.Uuid(), sa.ForeignKey("note_sessions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(2048), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "transcribed", "failed", name="note_audio_chunk_status"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("transcript_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_note_audio_chunks_session_index",
        "note_session_audio_chunks",
        ["session_id", "chunk_index"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_note_audio_chunks_session_index", table_name="note_session_audio_chunks")
    op.drop_table("note_session_audio_chunks")
    op.execute("DROP TYPE IF EXISTS note_audio_chunk_status")
    op.drop_column("note_sessions", "backup_transcript_text")
