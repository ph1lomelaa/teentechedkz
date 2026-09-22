"""mentor_assignment_history.replacement_mentor_id — nullable.

Зачем
-----
Снятие ответственного без замены («Снять» в «Команде ученика», перетаскивание
в «Без ответственного» на доске) пишет строку истории, в которой замены нет.
Колонка была NOT NULL при `ondelete=SET NULL` — это противоречие жило и
раньше: удаление сотрудника, который кого-то заменял, упало бы на ней же.

Revision ID: 092
Revises: 091
Create Date: 2026-09-21
"""
from alembic import op

revision = "092"
down_revision = "091"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("mentor_assignment_history", "replacement_mentor_id", nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM mentor_assignment_history WHERE replacement_mentor_id IS NULL")
    op.alter_column("mentor_assignment_history", "replacement_mentor_id", nullable=False)
