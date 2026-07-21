"""Meetings between student and mentor (calendar)

Revision ID: 015
Revises: 014
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None

status_vals = ("scheduled", "completed", "cancelled")


def upgrade() -> None:
    bind = op.get_bind()
    sa.Enum(*status_vals, name="meeting_status").create(bind, checkfirst=True)

    op.create_table(
        "meetings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mentor_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("meeting_link", sa.String(2048), nullable=False, server_default=""),
        sa.Column("recording_url", sa.String(2048), nullable=False, server_default=""),
        sa.Column("transcript_url", sa.String(2048), nullable=False, server_default=""),
        sa.Column("status", sa.Enum(*status_vals, name="meeting_status", create_type=False), nullable=False, server_default="scheduled"),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_meetings_student_id", "meetings", ["student_id"])
    op.create_index("ix_meetings_starts_at", "meetings", ["starts_at"])


def downgrade() -> None:
    op.drop_table("meetings")
    op.execute("DROP TYPE IF EXISTS meeting_status")
