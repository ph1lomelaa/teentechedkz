"""Private historical experience in student portfolios."""
from alembic import op
import sqlalchemy as sa
revision = '135'
down_revision = '134'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('activities', sa.Column('portfolio_student_id', sa.Uuid(), sa.ForeignKey('students.id', ondelete='CASCADE'), nullable=True))
    op.create_index('ix_activities_portfolio_student_id', 'activities', ['portfolio_student_id'])
    op.add_column('student_activities', sa.Column('is_historical', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('student_activities', sa.Column('participation_period', sa.String(255), nullable=True))
    op.add_column('student_activities', sa.Column('participation_role', sa.String(500), nullable=True))

def downgrade():
    for name in ('participation_role', 'participation_period', 'is_historical'):
        op.drop_column('student_activities', name)
    op.drop_index('ix_activities_portfolio_student_id', table_name='activities')
    op.drop_column('activities', 'portfolio_student_id')
