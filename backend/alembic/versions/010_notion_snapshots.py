"""Notion snapshots: read-only зеркало базы «Весь пайплайн клиентов»

Revision ID: 010
Revises: 009
Create Date: 2026-07-05
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None

notion_match_status = sa.Enum("new", "linked", "ignored", name="notion_match_status")


def upgrade() -> None:
    op.create_table(
        "notion_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("notion_page_id", sa.String(64), nullable=False),
        sa.Column("notion_url", sa.String(2048), nullable=True),
        sa.Column("full_name", sa.String(500), nullable=True),
        sa.Column("phone_normalized", sa.String(100), nullable=True),
        sa.Column("raw_properties", JSONB, nullable=False),
        sa.Column("normalized_data", JSONB, nullable=False),
        sa.Column("notion_last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "suggested_student_id",
            UUID(as_uuid=True),
            sa.ForeignKey("students.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("suggested_confidence", sa.Float, nullable=True),
        sa.Column(
            "student_id",
            UUID(as_uuid=True),
            sa.ForeignKey("students.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", notion_match_status, nullable=False, server_default="new"),
        sa.Column("linked_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_notion_snapshots_notion_page_id", "notion_snapshots", ["notion_page_id"], unique=True)
    op.create_index("ix_notion_snapshots_phone_normalized", "notion_snapshots", ["phone_normalized"])
    op.create_index("ix_notion_snapshots_student_id", "notion_snapshots", ["student_id"])


def downgrade() -> None:
    op.drop_table("notion_snapshots")
    notion_match_status.drop(op.get_bind(), checkfirst=True)
