"""Collapse duplicate services and forbid new ones.

Соединение студентов (`POST /students/{id}/merge`) переносило услуги слепым
`UPDATE services SET student_id = target`. У обоих студентов уже есть полный
стандартный набор из шести услуг (`ensure_default_services`), поэтому у цели
оставалось 12 строк — и карточка показывала «Профориентация, IELTS Mock, …»
дважды подряд. Причину поправили в students.py, здесь чистим последствия.

Схлопываем группу `(student_id, service_type)` в самую раннюю строку, забирая
из дубликатов только те поля, которых в ней нет: `included=True` и любой
статус кроме `not_started` — это осмысленный выбор менеджера, потерять его
нельзя. Затем ставим UNIQUE, чтобы дубликаты не могли появиться снова ни
через слияние, ни через гонку двух параллельных `POST /services`.

Косвенное подтверждение, что дубликаты в базе уже есть: sync.py брал
`.scalars().all()[0]` там, где просится `scalar_one_or_none()` — обход
MultipleResultsFound. После этой миграции такой обход больше не нужен.

Revision ID: 066
Revises: 065
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Победитель в каждой группе — самая ранняя строка. created_at может
    # совпадать (набор заводится одним вызовом), поэтому доупорядочиваем по id,
    # иначе выбор победителя недетерминирован.
    op.execute(
        """
        CREATE TEMPORARY TABLE _svc_dedupe AS
        SELECT id,
               FIRST_VALUE(id) OVER (
                   PARTITION BY student_id, service_type
                   ORDER BY created_at, id
               ) AS keep_id
        FROM services
        """
    )

    # Переносим на победителя заполненные поля из дубликатов. COALESCE берёт
    # первое непустое, порядок агрегации задаёт приоритет самой ранней строки.
    op.execute(
        """
        UPDATE services AS s
        SET included = agg.included,
            status = agg.status,
            contract_id = COALESCE(s.contract_id, agg.contract_id),
            result = COALESCE(s.result, agg.result),
            assigned_mentor_id = COALESCE(s.assigned_mentor_id, agg.assigned_mentor_id),
            deadline = COALESCE(s.deadline, agg.deadline),
            notes = COALESCE(s.notes, agg.notes),
            portfolio_directions_count = COALESCE(s.portfolio_directions_count, agg.portfolio_directions_count),
            portfolio_directions_types = COALESCE(s.portfolio_directions_types, agg.portfolio_directions_types),
            proforientation_specialty = COALESCE(s.proforientation_specialty, agg.proforientation_specialty)
        FROM (
            SELECT d.keep_id,
                   bool_or(dup.included) AS included,
                   -- Любой прогресс важнее not_started; из нескольких
                   -- продвинутых берём произвольный, но детерминированно.
                   COALESCE(
                       MIN(dup.status::text) FILTER (WHERE dup.status <> 'not_started'),
                       'not_started'
                   )::service_status AS status,
                   MIN(dup.contract_id::text)::uuid AS contract_id,
                   MIN(dup.result) AS result,
                   MIN(dup.assigned_mentor_id::text)::uuid AS assigned_mentor_id,
                   MIN(dup.deadline) AS deadline,
                   MIN(dup.notes) AS notes,
                   MIN(dup.portfolio_directions_count) AS portfolio_directions_count,
                   MIN(dup.portfolio_directions_types) AS portfolio_directions_types,
                   MIN(dup.proforientation_specialty) AS proforientation_specialty
            FROM _svc_dedupe d
            JOIN services dup ON dup.id = d.id
            GROUP BY d.keep_id
            HAVING count(*) > 1
        ) AS agg
        WHERE s.id = agg.keep_id
        """
    )

    op.execute("DELETE FROM services WHERE id IN (SELECT id FROM _svc_dedupe WHERE id <> keep_id)")
    op.execute("DROP TABLE _svc_dedupe")

    op.create_unique_constraint(
        "uq_services_student_service_type",
        "services",
        ["student_id", "service_type"],
    )


def downgrade() -> None:
    # Схлопнутые строки не восстанавливаются — снимаем только ограничение.
    op.drop_constraint("uq_services_student_service_type", "services", type_="unique")
