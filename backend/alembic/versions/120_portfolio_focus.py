"""Mentor's portfolio focus: one short note per student."""
from alembic import op
import sqlalchemy as sa

revision = '120'
down_revision = '117'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('portfolio_focus',
        sa.Column('student_id', sa.UUID(), sa.ForeignKey('students.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_by', sa.UUID(), sa.ForeignKey('users.id', ondelete='SET NULL')))


def downgrade():
    op.drop_table('portfolio_focus')
