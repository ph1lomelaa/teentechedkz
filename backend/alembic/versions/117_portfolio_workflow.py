"""Student-owned tasks, participation results and reusable document links."""
from alembic import op
import sqlalchemy as sa

revision = '117'
down_revision = '115'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('roadmap_tasks', sa.Column('student_id', sa.UUID(), nullable=True))
    op.execute('UPDATE roadmap_tasks t SET student_id = r.student_id FROM roadmaps r WHERE t.roadmap_id = r.id')
    op.alter_column('roadmap_tasks', 'student_id', nullable=False)
    op.create_foreign_key('fk_learner_task_student', 'roadmap_tasks', 'students', ['student_id'], ['id'], ondelete='CASCADE')
    op.create_index('ix_roadmap_tasks_student_id', 'roadmap_tasks', ['student_id'])
    for field in ('stage_id', 'roadmap_id'):
        op.alter_column('roadmap_tasks', field, nullable=True)
    op.execute('ALTER TABLE roadmap_tasks ADD CONSTRAINT ck_learner_task_context CHECK ((stage_id IS NULL) = (roadmap_id IS NULL))')
    op.add_column('roadmap_tasks', sa.Column('creation_key', sa.UUID()))
    op.create_unique_constraint('uq_learner_task_creation_key', 'roadmap_tasks', ['creation_key'])
    op.add_column('roadmap_tasks', sa.Column('requires_review', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('roadmap_tasks', sa.Column('requires_evidence', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('roadmap_tasks', sa.Column('result_text', sa.Text()))
    for field in ('result_text', 'result_review_comment', 'decline_reason'):
        op.add_column('student_activities', sa.Column(field, sa.Text()))
    op.add_column('student_activities', sa.Column('result_review_status', sa.String(20), nullable=False, server_default='none'))
    for field in ('result_submitted_at', 'result_reviewed_at'):
        op.add_column('student_activities', sa.Column(field, sa.DateTime(timezone=True)))
    op.add_column('student_activities', sa.Column('result_reviewed_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL')))
    op.create_table('portfolio_document_links',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('document_id', sa.UUID(), sa.ForeignKey('documents.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', sa.UUID(), sa.ForeignKey('roadmap_tasks.id', ondelete='CASCADE')),
        sa.Column('participation_id', sa.UUID(), sa.ForeignKey('student_activities.id', ondelete='CASCADE')),
        sa.Column('purpose', sa.String(20), nullable=False),
        sa.CheckConstraint("(purpose = 'evidence' AND task_id IS NOT NULL AND participation_id IS NULL) OR (purpose = 'result' AND task_id IS NULL AND participation_id IS NOT NULL)", name='ck_portfolio_document_target'))
    for field in ('document_id', 'task_id', 'participation_id'):
        op.create_index('ix_portfolio_document_links_' + field, 'portfolio_document_links', [field])
    op.create_index('uq_portfolio_document_task', 'portfolio_document_links', ['document_id', 'task_id'], unique=True, postgresql_where=sa.text('task_id IS NOT NULL'))
    op.create_index('uq_portfolio_document_participation', 'portfolio_document_links', ['document_id', 'participation_id'], unique=True, postgresql_where=sa.text('participation_id IS NOT NULL'))


def downgrade():
    # Fail rather than lose student tasks that cannot fit the previous schema.
    op.alter_column('roadmap_tasks', 'stage_id', nullable=False)
    op.alter_column('roadmap_tasks', 'roadmap_id', nullable=False)
    op.drop_table('portfolio_document_links')
    for field in ('result_text', 'result_review_status', 'result_review_comment', 'result_submitted_at', 'result_reviewed_at', 'result_reviewed_by', 'decline_reason'):
        op.drop_column('student_activities', field)
    op.drop_constraint('ck_learner_task_context', 'roadmap_tasks', type_='check')
    for field in ('creation_key', 'requires_review', 'requires_evidence', 'result_text', 'student_id'):
        op.drop_column('roadmap_tasks', field)
