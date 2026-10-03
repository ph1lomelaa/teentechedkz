"""Portal URL and application link on university credentials.

Регламент admission: ментор обязан передать ссылку, логин и пароль от
портала каждой подачи — без них оффер/зачисление не отмечается.

Revision ID: 103
Revises: 102
"""
from alembic import op
import sqlalchemy as sa

revision = '103'
down_revision = '102'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'university_credentials',
        sa.Column('portal_url', sa.String(1000), nullable=False, server_default=''),
    )
    op.add_column(
        'university_credentials',
        sa.Column(
            'application_id', sa.Uuid(),
            sa.ForeignKey('applications.id', ondelete='SET NULL'), nullable=True,
        ),
    )
    op.create_index(
        'ix_university_credentials_application_id', 'university_credentials', ['application_id'],
    )


def downgrade():
    op.drop_index('ix_university_credentials_application_id', table_name='university_credentials')
    op.drop_column('university_credentials', 'application_id')
    op.drop_column('university_credentials', 'portal_url')
