"""Shelf focus cells, recommendation decide-by, required result file, step submission history."""
from alembic import op
import sqlalchemy as sa

revision = '123'
down_revision = '122'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('portfolio_focus', sa.Column('types', sa.JSON(), nullable=False, server_default='[]'))
    op.add_column('student_activities', sa.Column('decide_by', sa.Date()))
    op.add_column('activities', sa.Column('result_requires_file', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table('roadmap_task_submissions',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('task_id', sa.UUID(), sa.ForeignKey('roadmap_tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('submitted_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('note', sa.Text()),
        sa.Column('document_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('verdict', sa.String(20), nullable=False, server_default='pending'),
        sa.Column('review_comment', sa.Text()),
        sa.Column('reviewed_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('reviewed_at', sa.DateTime(timezone=True)))
    op.create_index('ix_roadmap_task_submissions_task_id', 'roadmap_task_submissions', ['task_id'])


def downgrade():
    op.drop_table('roadmap_task_submissions')
    op.drop_column('activities', 'result_requires_file')
    op.drop_column('student_activities', 'decide_by')
    op.drop_column('portfolio_focus', 'types')
