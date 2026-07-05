"""add intake_submissions table for Google Sheets form sync

Revision ID: 003
Revises: 002
Create Date: 2026-07-03
"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from alembic import op

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None

intake_source = sa.Enum('package', 'cases', name='intake_source')
intake_status = sa.Enum('new', 'linked', 'ignored', name='intake_status')


def upgrade() -> None:
    intake_source.create(op.get_bind(), checkfirst=True)
    intake_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        'intake_submissions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('source', intake_source, nullable=False),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('row_fingerprint', sa.String(64), nullable=False, unique=True),
        sa.Column('raw_data', JSONB, nullable=False),
        sa.Column('full_name', sa.String(500), nullable=True),
        sa.Column('phone_normalized', sa.String(100), nullable=True),
        sa.Column('manager_name', sa.String(200), nullable=True),
        sa.Column('suggested_student_id', UUID(as_uuid=True),
                  sa.ForeignKey('students.id', ondelete='SET NULL'), nullable=True),
        sa.Column('suggested_confidence', sa.Float, nullable=True),
        sa.Column('student_id', UUID(as_uuid=True),
                  sa.ForeignKey('students.id', ondelete='SET NULL'), nullable=True),
        sa.Column('status', intake_status, nullable=False, server_default='new'),
        sa.Column('linked_by', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('linked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index('ix_intake_submissions_row_fingerprint', 'intake_submissions', ['row_fingerprint'])
    op.create_index('ix_intake_submissions_phone_normalized', 'intake_submissions', ['phone_normalized'])
    op.create_index('ix_intake_submissions_student_id', 'intake_submissions', ['student_id'])


def downgrade() -> None:
    op.drop_table('intake_submissions')
    intake_status.drop(op.get_bind(), checkfirst=True)
    intake_source.drop(op.get_bind(), checkfirst=True)
