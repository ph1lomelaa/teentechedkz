"""Protect locally edited roadmap templates and detect concurrent edits."""
from alembic import op
import sqlalchemy as sa

revision = '125'
down_revision = '124'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('roadmap_templates', sa.Column('locally_edited', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('roadmap_templates', sa.Column('revision', sa.Integer(), nullable=False, server_default='1'))


def downgrade():
    op.drop_column('roadmap_templates', 'revision')
    op.drop_column('roadmap_templates', 'locally_edited')
