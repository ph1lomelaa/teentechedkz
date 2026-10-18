"""Bind queued contract edits to their reviewed contract identity."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "119"
down_revision = "118"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("notion_field_sync_outbox", sa.Column("expected_contract_id", postgresql.UUID(as_uuid=True), nullable=True))


def downgrade():
    op.drop_column("notion_field_sync_outbox", "expected_contract_id")
