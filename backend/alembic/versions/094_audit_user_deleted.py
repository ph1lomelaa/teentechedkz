"""Аудит: удаление аккаунта.

Зачем
-----
`DELETE /users/{id}` теперь действительно удаляет аккаунт (раньше только снимал
`is_active`), и это единственное необратимое действие в разделе пользователей.
После него ни имени, ни почты в базе не останется, поэтому строка аудита с ними
в `meta` — единственный способ ответить на вопрос «кто был этот идентификатор».

У `audit_logs` нет внешнего ключа на `users`, так что запись переживает само
удаление.

ALTER TYPE ... ADD VALUE не выполняется внутри транзакции — autocommit block,
тот же приём, что в 089_mentor_role_mzk.py.

Revision ID: 094
Revises: 093
Create Date: 2026-09-24
"""
from alembic import op

revision = "094"
down_revision = "093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'user_deleted'")


def downgrade() -> None:
    # Postgres не умеет удалять значение enum без пересоздания типа.
    pass
