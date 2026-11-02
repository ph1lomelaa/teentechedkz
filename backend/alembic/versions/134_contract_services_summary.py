"""Contract services summary for the acts table."""
from alembic import op
import sqlalchemy as sa
revision = '134'
down_revision = '133'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('trustme_contract_links', sa.Column('services_summary', sa.JSON(), nullable=True))

def downgrade():
    op.drop_column('trustme_contract_links', 'services_summary')
