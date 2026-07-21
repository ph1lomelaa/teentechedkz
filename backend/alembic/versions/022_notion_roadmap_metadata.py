"""Notion source metadata for roadmap templates and tasks.

Revision ID: 022
Revises: 021
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "022"
down_revision = "021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("roadmap_templates", sa.Column("source_notion_db_id", sa.String(80), nullable=True))
    op.add_column("roadmap_templates", sa.Column("source_notion_title", sa.String(500), nullable=True))
    op.add_column("roadmap_templates", sa.Column("source_notion_last_edited_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        "ix_roadmap_templates_source_notion_db_id",
        "roadmap_templates",
        ["source_notion_db_id"],
        unique=True,
    )

    for table in ("template_tasks", "roadmap_tasks"):
        op.add_column(table, sa.Column("expected_result", sa.Text(), nullable=False, server_default=""))
        op.add_column(table, sa.Column("needs_document", sa.Boolean(), nullable=False, server_default=sa.false()))
        op.add_column(table, sa.Column("needs_zoom", sa.Boolean(), nullable=False, server_default=sa.false()))
        op.add_column(table, sa.Column("questionnaire_url", sa.String(2048), nullable=True))

    op.add_column("template_tasks", sa.Column("source_notion_page_id", sa.String(80), nullable=True))
    op.create_index(
        "ix_template_tasks_source_notion_page_id",
        "template_tasks",
        ["source_notion_page_id"],
        unique=True,
    )

    op.add_column("template_subtasks", sa.Column("source_notion_page_id", sa.String(80), nullable=True))
    op.create_index(
        "ix_template_subtasks_source_notion_page_id",
        "template_subtasks",
        ["source_notion_page_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_template_subtasks_source_notion_page_id", table_name="template_subtasks")
    op.drop_column("template_subtasks", "source_notion_page_id")

    op.drop_index("ix_template_tasks_source_notion_page_id", table_name="template_tasks")
    op.drop_column("template_tasks", "source_notion_page_id")

    for table in ("roadmap_tasks", "template_tasks"):
        op.drop_column(table, "questionnaire_url")
        op.drop_column(table, "needs_zoom")
        op.drop_column(table, "needs_document")
        op.drop_column(table, "expected_result")

    op.drop_index("ix_roadmap_templates_source_notion_db_id", table_name="roadmap_templates")
    op.drop_column("roadmap_templates", "source_notion_last_edited_at")
    op.drop_column("roadmap_templates", "source_notion_title")
    op.drop_column("roadmap_templates", "source_notion_db_id")
