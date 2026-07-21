"""Country catalog degree-level filters.

Revision ID: 032
Revises: 031
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "032"
down_revision = "031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "country_reference",
        sa.Column(
            "degree_levels",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[\"undergraduate\", \"graduate\"]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("country_reference", "degree_levels")
