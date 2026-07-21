"""Create knowledge_articles table for curated Notion reference pages.

Revision ID: 038
Revises: 037
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa

revision = "038"
down_revision = "037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_articles",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=True),
        sa.Column("body_html", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_notion_page_id", sa.String(length=80), nullable=False),
        sa.Column("source_notion_url", sa.String(length=500), nullable=True),
        sa.Column("source_last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_knowledge_articles_source_notion_page_id",
        "knowledge_articles",
        ["source_notion_page_id"],
        unique=True,
    )
    op.create_index(
        "ix_knowledge_articles_category",
        "knowledge_articles",
        ["category"],
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_articles_category", table_name="knowledge_articles")
    op.drop_index("ix_knowledge_articles_source_notion_page_id", table_name="knowledge_articles")
    op.drop_table("knowledge_articles")
