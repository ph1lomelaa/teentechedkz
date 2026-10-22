"""Explicit experience type and reusable step templates for activities."""
from alembic import op
import sqlalchemy as sa

revision = '121'
down_revision = '120'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('activities', sa.Column('experience_type', sa.String(20)))
    op.create_table('activity_step_templates',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('activity_id', sa.UUID(), sa.ForeignKey('activities.id', ondelete='CASCADE'), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('description', sa.Text(), nullable=False, server_default=''),
        sa.Column('expected_result', sa.Text(), nullable=False, server_default=''),
        sa.Column('priority', sa.String(20), nullable=False, server_default='required'),
        sa.Column('requires_review', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('requires_evidence', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('days_before_deadline', sa.Integer()),
        sa.Column('subtasks', sa.JSON(), nullable=False, server_default='[]'))
    op.create_index('ix_activity_step_templates_activity_id', 'activity_step_templates', ['activity_id'])


def downgrade():
    op.drop_table('activity_step_templates')
    op.drop_column('activities', 'experience_type')
