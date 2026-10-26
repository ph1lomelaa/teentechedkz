"""Template step due offset for rolling and self-paced intakes."""
from alembic import op
import sqlalchemy as sa

revision = '124'
down_revision = '123'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('activity_step_templates', sa.Column('days_after_start', sa.Integer()))


def downgrade():
    op.drop_column('activity_step_templates', 'days_after_start')
