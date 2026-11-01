"""Durable per-recipient finance mail delivery journal."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
revision = '130'
down_revision = '129'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('finance_mail_deliveries',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('recipient_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('recipient', sa.String(320), nullable=False),
        sa.Column('student_id', UUID(as_uuid=True), sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=False),
        sa.Column('contract_id', UUID(as_uuid=True), sa.ForeignKey('contracts.id', ondelete='SET NULL')),
        sa.Column('subject', sa.String(500), nullable=False), sa.Column('body', sa.Text(), nullable=False), sa.Column('html', sa.Text(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False), sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('claimed_at', sa.DateTime(timezone=True)), sa.Column('finished_at', sa.DateTime(timezone=True)),
        sa.Column('last_error', sa.String(500)), sa.Column('created_at', sa.DateTime(timezone=True), nullable=False))
    for column in ('student_id', 'status'):
        op.create_index(f'ix_finance_mail_deliveries_{column}', 'finance_mail_deliveries', [column])
    op.create_table('finance_mail_events',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('delivery_id', UUID(as_uuid=True), sa.ForeignKey('finance_mail_deliveries.id', ondelete='CASCADE'), nullable=False),
        sa.Column('event_id', UUID(as_uuid=True), sa.ForeignKey('finance_change_events.id', ondelete='CASCADE'), nullable=False),
        sa.Column('recipient_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.UniqueConstraint('event_id', 'recipient_id', name='uq_finance_mail_event_recipient'))
    for column in ('delivery_id', 'event_id'):
        op.create_index(f'ix_finance_mail_events_{column}', 'finance_mail_events', [column])


def downgrade():
    op.drop_table('finance_mail_events')
    op.drop_table('finance_mail_deliveries')
