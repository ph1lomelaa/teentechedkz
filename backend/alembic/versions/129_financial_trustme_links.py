"""Assign TrustMe documents to financial contracts without automatic matching."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = "129"
down_revision = "128"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("trustme_contract_links", sa.Column("financial_contract_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_trustme_financial_contract", "trustme_contract_links", "contracts", ["financial_contract_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_trustme_contract_links_financial_contract_id", "trustme_contract_links", ["financial_contract_id"])

def downgrade():
    op.drop_index("ix_trustme_contract_links_financial_contract_id", "trustme_contract_links")
    op.drop_constraint("fk_trustme_financial_contract", "trustme_contract_links", type_="foreignkey")
    op.drop_column("trustme_contract_links", "financial_contract_id")
