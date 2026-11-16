"""Уведомления и письма финансиста (задание 7 плана 14.11.2026).

- finance_mail_deliveries.kind: change (срочное письмо по договору), summary
  (утренняя сводка), backlog («Пока не было связи, произошло N изменений»);
  student_id может быть пустым — сводка не про одного ученика.
- users.finance_prefs: какие события срочные, время сводки, подписка админа.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '143'
down_revision = '142'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('finance_mail_deliveries', sa.Column('kind', sa.String(20), nullable=False, server_default='change'))
    op.alter_column('finance_mail_deliveries', 'student_id', existing_type=sa.Uuid(), nullable=True)
    op.add_column('finance_mail_deliveries', sa.Column('failure_notified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('finance_prefs', postgresql.JSONB(), nullable=True))


def downgrade():
    op.drop_column('users', 'finance_prefs')
    op.drop_column('finance_mail_deliveries', 'failure_notified_at')
    op.execute("DELETE FROM finance_mail_deliveries WHERE student_id IS NULL")
    op.alter_column('finance_mail_deliveries', 'student_id', existing_type=sa.Uuid(), nullable=False)
    op.drop_column('finance_mail_deliveries', 'kind')
