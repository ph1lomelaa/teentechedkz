"""Student links to verified TrustMe documents."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "127"
down_revision = "126"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "trustme_contract_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.String(64), nullable=False),
        sa.Column("external_id", sa.String(64), nullable=False),
        sa.Column("short_url", sa.String(64), nullable=False),
        sa.Column("name", sa.String(1000), nullable=False),
        sa.Column("number", sa.String(200)),
        sa.Column("status", sa.Integer(), nullable=False),
        sa.Column("signers", sa.JSON(), nullable=False),
        sa.Column("contract_created_at", sa.String(64)),
        sa.Column("linked_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("linked_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("company_id", "external_id", name="uq_trustme_company_document"),
    )
    op.create_index("ix_trustme_contract_links_student_id", "trustme_contract_links", ["student_id"])


def downgrade():
    op.drop_table("trustme_contract_links")
