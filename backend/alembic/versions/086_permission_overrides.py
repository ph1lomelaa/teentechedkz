"""Настраиваемые права: переопределения состава ролей из конструктора.

Revision ID: 086
Revises: 085
Create Date: 2026-08-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "086"
down_revision = "085"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Новое значение enum-а аудита. ADD VALUE идемпотентен через IF NOT EXISTS,
    # поэтому повторный прогон миграции на частично применённой базе не падает.
    op.execute("ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'permission_changed'")

    op.create_table(
        "permission_overrides",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("resource", sa.String(length=100), nullable=False),
        sa.Column("action", sa.String(length=20), nullable=False),
        sa.Column("roles", postgresql.JSONB(), nullable=False),
        sa.Column("updated_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("resource", "action", name="uq_permission_override_key"),
    )


def downgrade() -> None:
    op.drop_table("permission_overrides")
    # Значение enum-а не удаляем: PostgreSQL не умеет DROP VALUE, а пересоздание
    # типа задело бы уже записанные строки аудита.
