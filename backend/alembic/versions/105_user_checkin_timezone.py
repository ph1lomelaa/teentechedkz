"""Personal timezone for the daily check-in.

Регламент п.2.1: ментор отмечается до 10:00 по Алматы, а менторы в Европе —
в 10:00 по своему времени. Пояс ментор выбирает сам; NULL — пояс компании.

Revision ID: 105
Revises: 104
"""
from alembic import op
import sqlalchemy as sa

revision = '105'
down_revision = '104'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('checkin_timezone', sa.String(64), nullable=True))


def downgrade():
    op.drop_column('users', 'checkin_timezone')
