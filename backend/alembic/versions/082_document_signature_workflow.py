"""Add per-student document signature workflow."""
from alembic import op
import sqlalchemy as sa

revision = "082"
down_revision = "081"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("signature_status", sa.String(length=20), nullable=False, server_default="none"))
    op.add_column("documents", sa.Column("signature_requested_by", sa.Uuid(), nullable=True))
    op.add_column("documents", sa.Column("signature_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("signature_viewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("signature_signed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("signature_signed_by", sa.Uuid(), nullable=True))
    op.add_column("documents", sa.Column("signature_full_name", sa.String(length=255), nullable=True))
    op.create_foreign_key("fk_documents_signature_requested_by", "documents", "users", ["signature_requested_by"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_documents_signature_signed_by", "documents", "users", ["signature_signed_by"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_documents_signature_signed_by", "documents", type_="foreignkey")
    op.drop_constraint("fk_documents_signature_requested_by", "documents", type_="foreignkey")
    for name in ("signature_full_name", "signature_signed_by", "signature_signed_at", "signature_viewed_at", "signature_requested_at", "signature_requested_by", "signature_status"):
        op.drop_column("documents", name)