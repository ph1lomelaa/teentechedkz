"""Mentor tasks (general + SLA) and daily check-ins.

Revision ID: 084
Revises: 083

Три связанных изменения:
1. student_tasks.student_id → nullable: МЗК ставит менторам и общие задачи,
   не привязанные к студенту.
2. SLA-поля задачи: срок в часах, точный дедлайн, ступень уже начисленной
   санкции (идемпотентность фонового цикла) и отметка о напоминании.
3. user_checkins: ежедневная отметка «я на месте».

Идемпотентно (IF NOT EXISTS / проверка через to_regclass): прод уже падал на
повторном накате не-идемпотентной миграции, см. 0567fe8..d84f6bc.
"""

from alembic import op


revision = "084"
down_revision = "083"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE student_tasks ALTER COLUMN student_id DROP NOT NULL")

    op.execute("ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS sla_hours INTEGER")
    op.execute(
        "ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS sla_penalty_color VARCHAR(20)"
    )
    op.execute(
        "ALTER TABLE student_tasks ADD COLUMN IF NOT EXISTS sla_reminded_at TIMESTAMPTZ"
    )
    # Фоновый цикл выбирает просроченные задачи по этому предикату каждые 15 мин.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_student_tasks_sla_due_at "
        "ON student_tasks (sla_due_at) WHERE sla_due_at IS NOT NULL"
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkin_status') THEN
                CREATE TYPE checkin_status AS ENUM ('on_time', 'late', 'missed');
            END IF;
        END $$;
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_checkins (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            checkin_date DATE NOT NULL,
            status checkin_status NOT NULL,
            checked_in_at TIMESTAMPTZ,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_user_checkin_per_day UNIQUE (user_id, checkin_date)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_checkins_user_id ON user_checkins (user_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_user_checkins_checkin_date ON user_checkins (checkin_date)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_checkins")
    op.execute("DROP TYPE IF EXISTS checkin_status")
    op.execute("DROP INDEX IF EXISTS ix_student_tasks_sla_due_at")
    for col in ("sla_reminded_at", "sla_penalty_color", "sla_due_at", "sla_hours"):
        op.execute(f"ALTER TABLE student_tasks DROP COLUMN IF EXISTS {col}")
    # student_id обратно NOT NULL: сначала убираем общие задачи, иначе откат
    # упадёт на существующих строках без студента.
    op.execute("DELETE FROM student_tasks WHERE student_id IS NULL")
    op.execute("ALTER TABLE student_tasks ALTER COLUMN student_id SET NOT NULL")
