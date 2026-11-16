"""Оплаты: распределение по строкам графика, отмена с причиной, плательщик;
строка графика «после оффера» без даты (задание 3 плана 14.11.2026).

- payment_allocations: одна оплата закрывает несколько строк графика или
  часть строки; нераспределённое — аванс клиента. Прежняя привязка
  payments.schedule_item_id переносится сюда на полную сумму оплаты.
- payments: статус cancelled + кто, когда, почему; плательщик.
- payment_schedule_items: after_offer, due_date может быть пустой, пока
  оффера нет (срок = дата оффера + N дней).
"""
from alembic import op
import sqlalchemy as sa

revision = '141'
down_revision = '140'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'cancelled'")

    op.add_column('payments', sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('payments', sa.Column('cancelled_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.add_column('payments', sa.Column('cancel_reason', sa.Text(), nullable=True))
    op.add_column('payments', sa.Column('payer', sa.String(20), nullable=True))

    op.create_table(
        'payment_allocations',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('payment_id', sa.Uuid(), sa.ForeignKey('payments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('schedule_item_id', sa.Uuid(), sa.ForeignKey('payment_schedule_items.id', ondelete='CASCADE'), nullable=False),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('payment_id', 'schedule_item_id', name='uq_payment_allocation'),
        sa.CheckConstraint('amount > 0', name='ck_payment_allocation_positive'),
    )
    op.create_index('ix_payment_allocations_payment_id', 'payment_allocations', ['payment_id'])
    op.create_index('ix_payment_allocations_schedule_item_id', 'payment_allocations', ['schedule_item_id'])
    op.execute(
        "INSERT INTO payment_allocations (id, payment_id, schedule_item_id, amount, created_at) "
        "SELECT gen_random_uuid(), id, schedule_item_id, amount, now() FROM payments "
        "WHERE schedule_item_id IS NOT NULL AND amount > 0"
    )

    op.add_column('payment_schedule_items', sa.Column('after_offer', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.alter_column('payment_schedule_items', 'due_date', existing_type=sa.Date(), nullable=True)


def downgrade():
    op.execute("UPDATE payment_schedule_items SET due_date = created_at::date WHERE due_date IS NULL")
    op.alter_column('payment_schedule_items', 'due_date', existing_type=sa.Date(), nullable=False)
    op.drop_column('payment_schedule_items', 'after_offer')
    op.drop_index('ix_payment_allocations_schedule_item_id', table_name='payment_allocations')
    op.drop_index('ix_payment_allocations_payment_id', table_name='payment_allocations')
    op.drop_table('payment_allocations')
    op.drop_column('payments', 'payer')
    op.drop_column('payments', 'cancel_reason')
    op.drop_column('payments', 'cancelled_by')
    op.drop_column('payments', 'cancelled_at')
    # Значение 'cancelled' в enum payment_status остаётся: Postgres не удаляет значения enum.
