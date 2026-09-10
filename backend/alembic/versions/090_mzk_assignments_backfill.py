"""Перенести МЗК из договоров в назначения.

Revision ID: 090
Revises: 089
Create Date: 2026-09-10

Зачем
-----
«Кто МЗК студента» жило в двух несвязанных местах. Назначение (в том числе
массовое распределение из общей базы) пишет `MentorAssignment(role='mzk')`,
а фильтр «Ответственный → МЗК», колонка «МЗК» и половина бэкенда читали
`contracts.mzk_manager_id`. Результат: Амина распределяет студентов между МЗК,
назначение проходит — и тут же «пропадает», потому что смотрят на другое поле.

Миграция 089 добавила саму роль; эта переносит накопленные данные, чтобы
источником истины стало назначение. Дальше поддерживать связь берётся
`_mirror_mzk_to_contract` (mentor_assignments.py): назначение → договор,
в одну сторону.

Что переносим
-------------
Самый свежий договор каждого студента с непустым `mzk_manager_id` — у студента
их может быть несколько (продления), и актуален последний. Студентов, у которых
активное назначение role='mzk' уже есть, не трогаем: там ответ дало
распределение, и договор мог отстать.

Архивных не пропускаем: карточку могут вернуть из архива, и тогда МЗК должен
остаться на месте, а не пропасть из-за момента запуска миграции.

`assigned_at` — дата договора, а не now(): назначение существовало с этого
момента, и история замен, если она понадобится, не должна выглядеть так, будто
всех переназначили в день выката.
"""
from alembic import op

revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        INSERT INTO mentor_assignments (
            id, student_id, mentor_id, role, assignment_status, is_active, assigned_at
        )
        SELECT
            gen_random_uuid(),
            c.student_id,
            c.mzk_manager_id,
            'mzk',
            'active',
            true,
            c.created_at
        FROM (
            SELECT DISTINCT ON (student_id) student_id, mzk_manager_id, created_at
            FROM contracts
            WHERE mzk_manager_id IS NOT NULL
            ORDER BY student_id, created_at DESC
        ) c
        WHERE NOT EXISTS (
            SELECT 1 FROM mentor_assignments m
            WHERE m.student_id = c.student_id
              AND m.role = 'mzk'
              AND m.is_active = true
              AND m.mentor_id IS NOT NULL
        )
        """
    )


def downgrade() -> None:
    # Откат удалял бы назначения, которые после апгрейда могли быть заменены
    # вручную (роль mzk пишет и обычное распределение — отличить перенесённое
    # от заведённого руками нечем). Потерять реальное назначение дороже, чем
    # оставить лишнее: договор при откате остаётся на месте и данные не теряются.
    pass
