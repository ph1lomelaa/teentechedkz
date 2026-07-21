"""Link documents to their source Telegram attachment.

Revision ID: 024
Revises: 023
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "024"
down_revision = "023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("source_telegram_attachment_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_documents_source_telegram_attachment",
        "documents",
        "telegram_attachments",
        ["source_telegram_attachment_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_documents_source_telegram_attachment_id",
        "documents",
        ["source_telegram_attachment_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_documents_source_telegram_attachment_id", table_name="documents")
    op.drop_constraint("fk_documents_source_telegram_attachment", "documents", type_="foreignkey")
    op.drop_column("documents", "source_telegram_attachment_id")
