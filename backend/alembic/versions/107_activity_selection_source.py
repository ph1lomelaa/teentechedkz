"""Track student choice versus staff assignment without guessing old history."""
from alembic import op
import sqlalchemy as sa
revision = '107'
down_revision = '106'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('student_activities', sa.Column('selection_source', sa.String(20), nullable=False, server_default='unknown'))
    op.add_column('student_activities', sa.Column('selected_by_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_activity_selected_by', 'student_activities', 'users', ['selected_by_id'], ['id'], ondelete='SET NULL')

def downgrade():
    op.drop_constraint('fk_activity_selected_by', 'student_activities', type_='foreignkey')
    op.drop_column('student_activities', 'selected_by_id')
    op.drop_column('student_activities', 'selection_source')
