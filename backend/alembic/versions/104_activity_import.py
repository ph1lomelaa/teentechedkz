"""Activity import provenance and duplicate protection."""
from alembic import op
import sqlalchemy as sa
revision = '104'
down_revision = '103'
branch_labels = None
depends_on = None

def upgrade():
    # Earlier local trial used numeric revision 104; keep its imported drafts.
    columns = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('activities')}
    if {'import_key', 'import_source'}.issubset(columns):
        return
    op.add_column('activities', sa.Column('import_key', sa.String(64), nullable=True))
    op.add_column('activities', sa.Column('import_source', sa.JSON(), nullable=True))
    op.create_unique_constraint('uq_activity_import_key', 'activities', ['import_key'])

def downgrade():
    op.drop_constraint('uq_activity_import_key', 'activities', type_='unique')
    op.drop_column('activities', 'import_source')
    op.drop_column('activities', 'import_key')
