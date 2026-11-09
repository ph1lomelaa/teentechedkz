"""Заявка сотрудника с почтой для писем; почта для писем финансиста."""
from alembic import op
import sqlalchemy as sa
revision = '137'
down_revision = '136'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('access_requests', sa.Column('contact_email', sa.String(320), nullable=True))
    op.add_column('users', sa.Column('notification_email', sa.String(320), nullable=True))

def downgrade():
    op.drop_column('users', 'notification_email')
    op.drop_column('access_requests', 'contact_email')
