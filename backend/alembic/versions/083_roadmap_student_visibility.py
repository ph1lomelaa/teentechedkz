"""Per-task and per-stage visibility for the student portal.

Revision ID: 083
Revises: 082

Идемпотентно (IF NOT EXISTS): прод уже ловил падение деплоя на повторном
накате не-идемпотентной миграции, см. 0567fe8..d84f6bc.

server_default=true — существующие роадмапы остаются видимыми студенту ровно
как были, скрытие включается точечно.
"""

from alembic import op


revision = "083"
down_revision = "082"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE stages ADD COLUMN IF NOT EXISTS visible_to_student "
        "BOOLEAN NOT NULL DEFAULT true"
    )
    op.execute(
        "ALTER TABLE roadmap_tasks ADD COLUMN IF NOT EXISTS visible_to_student "
        "BOOLEAN NOT NULL DEFAULT true"
    )


def downgrade() -> None:
    op.drop_column("roadmap_tasks", "visible_to_student")
    op.drop_column("stages", "visible_to_student")
