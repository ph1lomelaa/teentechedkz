"""Confirmed Notion person aliases, separate from student assignments."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "118"
down_revision = "116"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("notion_person_links",
        sa.Column("notion_key", sa.String(500), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("confirmed_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_notion_person_links_user_id", "notion_person_links", ["user_id"])


def downgrade():
    op.drop_table("notion_person_links")
