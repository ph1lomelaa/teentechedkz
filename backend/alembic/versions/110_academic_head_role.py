"""Роль academic_head («Академический руководитель»)

Надзор за менторами: задачи менторам, их данные и отметки, одобрение заявок
на доступ. Права выдаёт реестр app/core/permissions.py.

Revision ID: 110
Revises: 109
Create Date: 2026-10-03
"""
from alembic import op

revision = "110"
down_revision = "109"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE нельзя внутри транзакции.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'academic_head'")


def downgrade() -> None:
    # Postgres не умеет удалять значение enum; пользователей с этой ролью
    # нужно перевести вручную, само значение остаётся безвредным.
    pass
