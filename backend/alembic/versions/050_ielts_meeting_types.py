"""Add ielts_lesson/ielts_mock to meeting_type enum (ОС 30/07, Блок E).

Расписание IELTS переиспользует Meeting вместо новой сущности — iCal-экспорт,
календарь, напоминания и привязка к ментору подхватываются бесплатно.

ALTER TYPE ... ADD VALUE cannot run inside a transaction — autocommit block
(см. 013_student_portal_access.py).

Revision ID: 050
Revises: 049
Create Date: 2026-08-03
"""
from alembic import op


revision = "050"
down_revision = "049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE meeting_type ADD VALUE IF NOT EXISTS 'ielts_lesson'")
        op.execute("ALTER TYPE meeting_type ADD VALUE IF NOT EXISTS 'ielts_mock'")


def downgrade() -> None:
    # Postgres cannot drop an enum value without recreating the type; not reverted.
    pass
