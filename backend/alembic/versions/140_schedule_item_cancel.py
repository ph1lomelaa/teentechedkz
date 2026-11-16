"""Строка графика платежей отменяется, а не удаляется (решение 14.11.2026).

Отменённая строка остаётся в истории договора с причиной, кто и когда
отменил; в суммы, списки и календарь не входит.
"""
from alembic import op
import sqlalchemy as sa

revision = '140'
down_revision = '139'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('payment_schedule_items', sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('payment_schedule_items', sa.Column(
        'cancelled_by', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True))
    op.add_column('payment_schedule_items', sa.Column('cancel_reason', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('payment_schedule_items', 'cancel_reason')
    op.drop_column('payment_schedule_items', 'cancelled_by')
    op.drop_column('payment_schedule_items', 'cancelled_at')
