"""Activity redesign: recommendation reason, personal deadline, conditions check date."""
from alembic import op
import sqlalchemy as sa
revision = '111'
down_revision = '110'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('student_activities', sa.Column('recommendation_note', sa.Text(), nullable=True))
    op.add_column('student_activities', sa.Column('personal_deadline', sa.Date(), nullable=True))
    op.add_column('activities', sa.Column('conditions_checked_at', sa.Date(), nullable=True))


def downgrade():
    op.drop_column('activities', 'conditions_checked_at')
    op.drop_column('student_activities', 'personal_deadline')
    op.drop_column('student_activities', 'recommendation_note')
