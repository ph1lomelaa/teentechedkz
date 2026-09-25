"""Несколько менторов по стране у одного ученика.

Зачем
-----
093 поставила «один активный ответственный на роль» на все роли сразу. Для МЗК,
ментора по УП, профориентолога и учителя IELTS это верно, а для ментора по
стране — нет: ученик подаётся в несколько стран, и каждую ведёт свой человек.
До сих пор второго приходилось не добавлять, а ставить вместо первого.

Индекс из 093 не правится на месте (он уже в main и мог быть накачен), поэтому
он пересоздаётся здесь: тот же ключ, но предикат сужен до ролей, где
единственность по-прежнему обязательна.

Для страны ключ расширяется `country_scope`: «США» и «Канада» уживаются, два
ментора на одну страну — нет. `NULLS NOT DISTINCT` (Postgres 15+; на проде и в
CI `postgres:15-alpine`) нужен, чтобы индекс считал дублем и двух ответственных
без указанной страны — иначе «несколько менторов по стране» означало бы
«сколько угодно неразличимых строк».

Чистка дублей здесь не нужна: её сделала 093, а эта миграция ограничение только
ослабляет. Единственное, что может помешать `uq_mentor_assignment_active_country`
встать, — два активных ментора по стране с одинаковым (в том числе пустым)
`country_scope`; после 093 такого состояния в базе быть не может.

Revision ID: 095
Revises: 094
Create Date: 2026-09-25
"""
from alembic import op

revision = "095"
down_revision = "094"
branch_labels = None
depends_on = None

_SINGLE = "uq_mentor_assignment_active_role"
_COUNTRY = "uq_mentor_assignment_active_country"


def upgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {_SINGLE}")
    op.execute(
        f"""
        CREATE UNIQUE INDEX {_SINGLE}
        ON mentor_assignments (student_id, role)
        WHERE is_active AND mentor_id IS NOT NULL AND role <> 'country'
        """
    )
    op.execute(
        f"""
        CREATE UNIQUE INDEX {_COUNTRY}
        ON mentor_assignments (student_id, role, country_scope)
        NULLS NOT DISTINCT
        WHERE is_active AND mentor_id IS NOT NULL AND role = 'country'
        """
    )


def downgrade() -> None:
    # Возврат к «одному на роль» требует, чтобы лишние менторы по стране были
    # сняты — иначе индекс не встанет. Гасим всех, кроме самого свежего в роли,
    # тем же правилом, что и 093: молча уронить downgrade хуже, чем оставить
    # след в assignment_status.
    op.execute(f"DROP INDEX IF EXISTS {_COUNTRY}")
    op.execute(
        """
        UPDATE mentor_assignments AS ma
        SET is_active = false,
            assignment_status = 'replaced'
        FROM (
            SELECT id,
                   row_number() OVER (
                       PARTITION BY student_id, role
                       ORDER BY assigned_at DESC, id DESC
                   ) AS rn
            FROM mentor_assignments
            WHERE is_active AND mentor_id IS NOT NULL AND role = 'country'
        ) AS ranked
        WHERE ma.id = ranked.id AND ranked.rn > 1
        """
    )
    op.execute(f"DROP INDEX IF EXISTS {_SINGLE}")
    op.execute(
        f"""
        CREATE UNIQUE INDEX {_SINGLE}
        ON mentor_assignments (student_id, role)
        WHERE is_active AND mentor_id IS NOT NULL
        """
    )
