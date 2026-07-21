"""Add payment_id to documents

Revision ID: 039
Revises: 038
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa

revision = "039"
down_revision = "038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("payment_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_documents_payment",
        "documents",
        "payments",
        ["payment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_documents_payment_id", "documents", ["payment_id"])


def downgrade() -> None:
    op.drop_index("ix_documents_payment_id", table_name="documents")
    op.drop_constraint("fk_documents_payment", "documents", type_="foreignkey")
    op.drop_column("documents", "payment_id")
