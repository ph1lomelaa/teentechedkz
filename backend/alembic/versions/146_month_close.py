"""Отчёты и закрытие месяца (задание 12 плана 14.11.2026).

- payments.reconciled_at / reconciled_by: «Сверено с выпиской».
- finance_closed_months: закрытый месяц — оплаты за него меняет только админ
  с причиной.
"""
from alembic import op
import sqlalchemy as sa

revision = '146'
down_revision = '145'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('payments', sa.Column('reconciled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('payments', sa.Column('reconciled_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.create_table(
        'finance_closed_months',
        sa.Column('month', sa.Date(), primary_key=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('closed_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
    )


def downgrade():
    op.drop_table('finance_closed_months')
    op.drop_column('payments', 'reconciled_by')
    op.drop_column('payments', 'reconciled_at')
