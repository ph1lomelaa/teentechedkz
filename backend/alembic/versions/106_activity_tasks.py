"""Link existing roadmap tasks to activity participation."""
from alembic import op
import sqlalchemy as sa
revision = '106'
down_revision = '105'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('roadmap_tasks', sa.Column('activity_participation_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_roadmap_task_activity', 'roadmap_tasks', 'student_activities', ['activity_participation_id'], ['id'], ondelete='SET NULL')
    op.create_index('ix_roadmap_tasks_activity_participation_id', 'roadmap_tasks', ['activity_participation_id'])

def downgrade():
    op.drop_index('ix_roadmap_tasks_activity_participation_id', table_name='roadmap_tasks')
    op.drop_constraint('fk_roadmap_task_activity', 'roadmap_tasks', type_='foreignkey')
    op.drop_column('roadmap_tasks', 'activity_participation_id')
