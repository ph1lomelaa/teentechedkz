"""Один активный ответственный на роль у студента.

Зачем
-----
Уникальности на (student_id, role) не было никогда, и оба слоя обходили это
руками: `_assign_one` ищет «прежнего» с условием `mentor_id != mentor_id` и
гасит всех найденных, а «Команда ученика» рисует предупреждение «Два
ответственных в одной роли». То есть дубль считался багом везде, но БД его
допускала — и он регулярно появлялся: старое «Добавить себя» не заменяло
текущего, а `ensure_lead_assignment` заводил вторую строку `lead` при первой же
встрече, не глядя на то, что человек уже ведёт студента в другой роли.

Индекс частичный по двум причинам. Снятые назначения (`is_active = false`) —
это история, их у одной роли законно много. Плейсхолдеры «требуется назначение»
(`mentor_id IS NULL`) заводятся по одному на роль при создании студента, но
проверять это индексом нельзя: заполнение плейсхолдера и создание новой строки
живут в одной транзакции с гашением прежней.

Сначала чистим, потом строим: на «грязной» таблице CREATE INDEX просто упадёт.

Revision ID: 093
Revises: 092
Create Date: 2026-09-24
"""
from alembic import op

revision = "093"
down_revision = "092"
branch_labels = None
depends_on = None

_INDEX = "uq_mentor_assignment_active_role"


def upgrade() -> None:
    # Из каждой группы дублей оставляем самое свежее назначение: оно и есть то,
    # что человек сделал последним. Остальные гасим как «заменённые» — не
    # удаляем, потому что на них может ссылаться история замен и потому что
    # молча терять запись о том, кто вёл студента, нельзя.
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
            WHERE is_active AND mentor_id IS NOT NULL
        ) AS ranked
        WHERE ma.id = ranked.id AND ranked.rn > 1
        """
    )

    op.execute(
        f"""
        CREATE UNIQUE INDEX {_INDEX}
        ON mentor_assignments (student_id, role)
        WHERE is_active AND mentor_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # Погашенные дубли обратно не поднимаем: какие из них были активны до
    # миграции, в таблице уже не записано, а «разгасить» все — значит вернуть
    # ровно ту рассинхронизацию, ради которой индекс и ставился.
    op.execute(f"DROP INDEX IF EXISTS {_INDEX}")
