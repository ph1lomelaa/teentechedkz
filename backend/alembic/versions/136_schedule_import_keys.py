"""Provenance of schedules imported from Notion (no duplicate import rows)."""
from alembic import op
import sqlalchemy as sa
revision = '136'
down_revision = '135'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('payment_schedule_items', sa.Column('import_key', sa.String(100), nullable=True))
    op.create_unique_constraint('uq_schedule_import_key', 'payment_schedule_items', ['import_key'])

def downgrade():
    op.drop_constraint('uq_schedule_import_key', 'payment_schedule_items', type_='unique')
    op.drop_column('payment_schedule_items', 'import_key')
