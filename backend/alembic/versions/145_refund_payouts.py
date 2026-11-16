"""Возвраты как денежная операция (задание 9 плана 14.11.2026).

- payment_type 'client_refund': выплата возврата клиенту (вносит финансист),
  вычитается из «по оплатам» и из «Поступило» отдельной строкой.
- refund_cases.approved_amount: сумма к возврату при согласовании (может
  отличаться от запрошенной); payout_payment_id — выплата.
"""
from alembic import op
import sqlalchemy as sa

revision = '145'
down_revision = '144'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_type ADD VALUE IF NOT EXISTS 'client_refund'")
    op.add_column('refund_cases', sa.Column('approved_amount', sa.Numeric(14, 2), nullable=True))
    op.add_column('refund_cases', sa.Column(
        'payout_payment_id', sa.Uuid(), sa.ForeignKey('payments.id', ondelete='SET NULL'), nullable=True))


def downgrade():
    op.drop_column('refund_cases', 'payout_payment_id')
    op.drop_column('refund_cases', 'approved_amount')
    # Значение 'client_refund' в enum payment_type остаётся: Postgres не удаляет значения enum.
