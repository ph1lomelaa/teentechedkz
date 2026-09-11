"""users.mentor_specialties — специализация ментора на аккаунте.

Зачем
-----
«Ментор по УП», «ментор по стране», «профориентолог» до сих пор существовали
только на связке ментор↔студент (MentorAssignment.role). Значит у ментора, за
которым ещё не закрепили студентов, специализации не было вообще: в списке
«кого назначить» все 16 менторов выглядели одинаково, и роль уходила наугад.

Поле — подпись, а не право: права остаются на users.role через
core/permissions.py.

Бэкфилла нет намеренно
----------------------
Заполнить поле из существующих MentorAssignment.role — значит смешать две
разные оси: «кем человек работает» и «кого он ведёт сейчас». Специализации
проставляются руками в «Настройки → Пользователи».

Revision ID: 091
Revises: 090
Create Date: 2026-09-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "091"
down_revision = "090"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "mentor_specialties",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "mentor_specialties")
