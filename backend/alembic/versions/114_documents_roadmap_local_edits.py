"""Add display names and local roadmap edit metadata.

Existing rows retain their names, visibility, storage paths and task content.
"""
from alembic import op
import sqlalchemy as sa

revision = "114"
down_revision = "113"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("documents", sa.Column("display_name", sa.String(500), nullable=True))
    for table in ("roadmap_tasks", "roadmap_subtasks"):
        op.add_column(table, sa.Column("source_notion_page_id", sa.String(80), nullable=True))
        op.add_column(table, sa.Column("manual_fields", sa.JSON(), nullable=False, server_default="[]"))
        op.add_column(table, sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(f"ix_{table}_source_notion_page_id", table, ["source_notion_page_id"])


def downgrade():
    for table in ("roadmap_subtasks", "roadmap_tasks"):
        op.drop_index(f"ix_{table}_source_notion_page_id", table_name=table)
        op.drop_column(table, "deleted_at")
        op.drop_column(table, "manual_fields")
        op.drop_column(table, "source_notion_page_id")
    op.drop_column("documents", "display_name")
