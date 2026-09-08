"""Mentor role: mzk (МЗК-менеджер как ответственный за студента).

Зачем
-----
Распределить студентов между менеджерами МЗК было нельзя: назначения знают
только про менторские роли, а менеджер мог лишь «взять на себя» одного
студента за раз. Новое значение роли даёт тот же механизм назначения —
массовое, с историей замен и с попаданием студента в «Мои студенты» менеджера.

В обязательную команду студента роль не входит: `required_roles` в students.py
и гейт этапа в roadmaps.py остаются на четырёх менторских ролях.

ALTER TYPE ... ADD VALUE не выполняется внутри транзакции — autocommit block,
тот же приём, что и в 052_mentor_role_country.py.

Revision ID: 089
Revises: 088
Create Date: 2026-09-09
"""
from alembic import op

revision = "089"
down_revision = "088"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE mentor_role ADD VALUE IF NOT EXISTS 'mzk'")


def downgrade() -> None:
    # Postgres cannot drop an enum value without recreating the type.
    pass
