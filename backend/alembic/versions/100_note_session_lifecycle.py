"""Note session lifecycle: draft/interrupted/failed statuses, language, capture mode.

Сессия создаётся черновиком (draft) и становится active только когда звук
реально пошёл; пустые черновики убирает фоновая очистка. interrupted — запись
оборвалась, но текст или аудио есть; failed — записать не удалось.

Revision ID: 100
Revises: 099
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa


revision = "100"
down_revision = "099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE нельзя выполнять внутри транзакции.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE note_session_status ADD VALUE IF NOT EXISTS 'draft'")
        op.execute("ALTER TYPE note_session_status ADD VALUE IF NOT EXISTS 'interrupted'")
        op.execute("ALTER TYPE note_session_status ADD VALUE IF NOT EXISTS 'failed'")

    op.add_column(
        "note_sessions",
        sa.Column("language", sa.String(16), nullable=False, server_default="ru"),
    )
    op.add_column(
        "note_sessions",
        sa.Column("capture_mode", sa.String(16), nullable=False, server_default="browser"),
    )


def downgrade() -> None:
    op.drop_column("note_sessions", "capture_mode")
    op.drop_column("note_sessions", "language")
    # Postgres cannot drop an enum value without recreating the type; not reverted.
