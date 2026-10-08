"""Persist idempotent CRM ↔ Notion field sync work and conflicts."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "113"
down_revision = "112"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notion_field_sync_outbox",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("dedupe_key", sa.String(64), nullable=False),
        sa.Column("notion_snapshot_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notion_page_id", sa.String(64), nullable=False),
        sa.Column("field_key", sa.String(100), nullable=False),
        sa.Column(
            "direction",
            sa.Enum("crm_to_notion", "notion_to_crm", "conflict", name="notion_field_sync_direction"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("pending", "processing", "dry_run", "succeeded", "resolved", "conflict", "failed", "superseded",
                    name="notion_field_sync_status"),
            server_default="pending",
            nullable=False,
        ),
        sa.Column("decision", sa.String(40), nullable=False),
        sa.Column("crm_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("notion_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("baseline_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("has_baseline", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("winning_side", sa.String(10), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("source_revision", sa.String(128), nullable=False),
        sa.Column("expected_notion_last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolution_side", sa.String(10), nullable=True),
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["notion_snapshot_id"], ["notion_snapshots.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("dedupe_key", name="uq_notion_field_sync_outbox_dedupe_key"),
    )
    op.create_index("ix_notion_field_sync_outbox_notion_snapshot_id", "notion_field_sync_outbox", ["notion_snapshot_id"])
    op.create_index("ix_notion_field_sync_outbox_student_id", "notion_field_sync_outbox", ["student_id"])
    op.create_index("ix_notion_field_sync_outbox_notion_page_id", "notion_field_sync_outbox", ["notion_page_id"])
    op.create_index("ix_notion_field_sync_outbox_status", "notion_field_sync_outbox", ["status"])
    op.create_index(
        "ix_notion_field_sync_outbox_claim",
        "notion_field_sync_outbox",
        ["status", "available_at", "locked_until"],
    )


def downgrade() -> None:
    op.drop_index("ix_notion_field_sync_outbox_claim", table_name="notion_field_sync_outbox")
    op.drop_index("ix_notion_field_sync_outbox_status", table_name="notion_field_sync_outbox")
    op.drop_index("ix_notion_field_sync_outbox_notion_page_id", table_name="notion_field_sync_outbox")
    op.drop_index("ix_notion_field_sync_outbox_student_id", table_name="notion_field_sync_outbox")
    op.drop_index("ix_notion_field_sync_outbox_notion_snapshot_id", table_name="notion_field_sync_outbox")
    op.drop_table("notion_field_sync_outbox")
    op.execute("DROP TYPE notion_field_sync_status")
    op.execute("DROP TYPE notion_field_sync_direction")
