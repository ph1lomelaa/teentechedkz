"""Activity catalogue, intakes and student participation.

Revision ID: 102
Revises: 101
"""
from alembic import op
import sqlalchemy as sa

revision = '102'
down_revision = '101'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('activities',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('direction', sa.String(255)),
        sa.Column('kind', sa.String(100)),
        sa.Column('organizer', sa.String(500)),
        sa.Column('country', sa.String(500)),
        sa.Column('description', sa.Text()),
        sa.Column('eligibility', sa.Text()),
        sa.Column('assignment', sa.Text()),
        sa.Column('source_url', sa.String(2048)),
        sa.Column('publication', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("publication IN ('draft','published','archived')", name='ck_activity_publication'),
    )
    op.create_table('activity_intakes',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('activity_id', sa.Uuid(), sa.ForeignKey('activities.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('label', sa.String(255), nullable=False),
        sa.Column('mode', sa.String(20), nullable=False, server_default='unknown'),
        sa.Column('deadline', sa.Date()),
        sa.Column('dates_text', sa.Text()),
        sa.Column('format', sa.String(100)),
        sa.Column('cost_state', sa.String(20), nullable=False, server_default='unknown'),
        sa.Column('cost_text', sa.String(500)),
        sa.CheckConstraint("mode IN ('fixed','rolling','self_paced','unknown')", name='ck_intake_mode'),
        sa.CheckConstraint("cost_state IN ('free','paid','unknown')", name='ck_intake_cost'),
    )
    op.create_index('ix_activity_intakes_activity_id', 'activity_intakes', ['activity_id'])
    op.create_table('student_activities',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('student_id', sa.Uuid(), sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=False),
        sa.Column('intake_id', sa.Uuid(), sa.ForeignKey('activity_intakes.id', ondelete='RESTRICT'), nullable=False),
        sa.Column('mentor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('decision', sa.String(20), nullable=False, server_default='selected'),
        sa.Column('status', sa.String(20), nullable=False, server_default='not_started'),
        sa.Column('goal', sa.Text()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint('student_id', 'intake_id', name='uq_student_activity_intake'),
        sa.CheckConstraint("decision IN ('suggested','selected','not_interested')", name='ck_participation_decision'),
        sa.CheckConstraint("status IN ('not_started','in_progress','submitted','completed','cancelled')", name='ck_participation_status'),
    )
    op.create_index('ix_student_activities_student_id', 'student_activities', ['student_id'])
    op.create_index('ix_student_activities_intake_id', 'student_activities', ['intake_id'])


def downgrade():
    op.drop_table('student_activities')
    op.drop_table('activity_intakes')
    op.drop_table('activities')
