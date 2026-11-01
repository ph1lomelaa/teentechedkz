"""Encrypted reusable contract requisites and current-status check timestamp."""
from alembic import op
import sqlalchemy as sa
revision='131'
down_revision='130'
branch_labels=None
depends_on=None

def upgrade():
    op.add_column('trustme_contract_links', sa.Column('profile_encrypted',sa.Text(),nullable=True))
    op.add_column('trustme_contract_links', sa.Column('profile_checked_at',sa.DateTime(timezone=True),nullable=True))

def downgrade():
    op.drop_column('trustme_contract_links','profile_checked_at')
    op.drop_column('trustme_contract_links','profile_encrypted')
