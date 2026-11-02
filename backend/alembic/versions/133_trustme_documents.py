"""Registry of every TrustMe contract the platform has read."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
revision = '133'
down_revision = '132'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('trustme_documents',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('company_id', sa.String(64), nullable=False),
        sa.Column('external_id', sa.String(64), nullable=False),
        sa.Column('short_url', sa.String(64), nullable=True),
        sa.Column('name', sa.String(1000), nullable=False, server_default=''),
        sa.Column('number', sa.String(200), nullable=True),
        sa.Column('status', sa.Integer(), nullable=False),
        sa.Column('contract_created_at', sa.String(64), nullable=True),
        sa.Column('facts_encrypted', sa.Text(), nullable=True),
        sa.Column('decision', sa.String(16), nullable=False),
        sa.Column('reason', sa.String(300), nullable=True),
        sa.Column('candidate_ids', sa.JSON(), nullable=False, server_default='[]'),
        sa.Column('link_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('trustme_contract_links.id', ondelete='SET NULL'), nullable=True),
        sa.Column('checked_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('company_id', 'external_id', name='uq_trustme_document'))
    op.create_index('ix_trustme_documents_decision', 'trustme_documents', ['decision'])

def downgrade():
    op.drop_index('ix_trustme_documents_decision', 'trustme_documents')
    op.drop_table('trustme_documents')
