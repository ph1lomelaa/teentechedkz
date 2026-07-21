"""Create scholarships table for Notion-synced educational programs.

Revision ID: 037
Revises: 036
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa

revision = "037"
down_revision = "036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scholarships",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("country_id", sa.UUID(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("requirements", sa.Text(), nullable=True),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("amount", sa.String(length=255), nullable=True),
        sa.Column("source_notion_page_id", sa.String(length=255), nullable=True),
        sa.Column("source_notion_last_edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["country_id"], ["countries.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scholarships_country_id", "scholarships", ["country_id"])
    op.create_index("ix_scholarships_name", "scholarships", ["name"])
    op.create_index("ix_scholarships_source_notion_page_id", "scholarships", ["source_notion_page_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_scholarships_source_notion_page_id", table_name="scholarships")
    op.drop_index("ix_scholarships_name", table_name="scholarships")
    op.drop_index("ix_scholarships_country_id", table_name="scholarships")
    op.drop_table("scholarships")
