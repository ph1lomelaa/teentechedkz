"""Manual contract PDFs and explicit signing dates."""
from alembic import op
import sqlalchemy as sa
revision = '132'
down_revision = '131'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('trustme_contract_links', sa.Column('source', sa.String(16), server_default='trustme', nullable=False))
    op.add_column('trustme_contract_links', sa.Column('storage_path', sa.Text(), nullable=True))
    op.add_column('trustme_contract_links', sa.Column('signed_date', sa.String(10), nullable=True))
    op.add_column('trustme_contract_links', sa.Column('signed_date_source', sa.String(16), nullable=True))

def downgrade():
    for column in ('signed_date_source', 'signed_date', 'storage_path', 'source'):
        op.drop_column('trustme_contract_links', column)
