"""Документы и акты (задание 11 плана 14.11.2026).

- contracts.number: номер договора отдельным полем для всех договоров (не
  только TrustMe); ведут МЗК и админ, поиск по номеру в финансах.
- contracts.documents_checked_at / _by: финансист отметил «Документы проверены».
- doc_type 'addendum_scan': скан допсоглашения (загружает МЗК, видит финансист).
"""
from alembic import op
import sqlalchemy as sa

revision = '142'
down_revision = '141'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE doc_type ADD VALUE IF NOT EXISTS 'addendum_scan'")
    op.add_column('contracts', sa.Column('number', sa.String(100), nullable=True))
    op.create_index('ix_contracts_number', 'contracts', ['number'])
    op.add_column('contracts', sa.Column('documents_checked_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('contracts', sa.Column(
        'documents_checked_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))


def downgrade():
    op.drop_column('contracts', 'documents_checked_by')
    op.drop_column('contracts', 'documents_checked_at')
    op.drop_index('ix_contracts_number', table_name='contracts')
    op.drop_column('contracts', 'number')
    # Значение 'addendum_scan' в enum doc_type остаётся: Postgres не удаляет значения enum.
