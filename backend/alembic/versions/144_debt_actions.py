"""Сбор долгов (задание 8 плана 14.11.2026): действия по просроченному платежу.

kind: contact (звонок / сообщение / встреча), promise (обещали оплатить дату и
сумму), reminder (напомнили МЗК), mzk_reply (ответ МЗК), escalated (передали
руководителю), reschedule (перенесли срок по согласованию), promise_broken,
mzk_silent (МЗК не ответил 7 дней), head_alert (60 дней — руководителю).
Ничего не удаляется: лента действий по долгу.
"""
from alembic import op
import sqlalchemy as sa

revision = '144'
down_revision = '143'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'debt_actions',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('schedule_item_id', sa.Uuid(), sa.ForeignKey('payment_schedule_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('contract_id', sa.Uuid(), sa.ForeignKey('contracts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(20), nullable=False),
        sa.Column('channel', sa.String(20), nullable=True),
        sa.Column('with_whom', sa.String(200), nullable=True),
        sa.Column('result', sa.Text(), nullable=True),
        sa.Column('promise_date', sa.Date(), nullable=True),
        sa.Column('promise_amount', sa.Numeric(18, 2), nullable=True),
        sa.Column('actor_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_debt_actions_schedule_item_id', 'debt_actions', ['schedule_item_id'])
    op.create_index('ix_debt_actions_contract_id', 'debt_actions', ['contract_id'])


def downgrade():
    op.drop_index('ix_debt_actions_contract_id', table_name='debt_actions')
    op.drop_index('ix_debt_actions_schedule_item_id', table_name='debt_actions')
    op.drop_table('debt_actions')
