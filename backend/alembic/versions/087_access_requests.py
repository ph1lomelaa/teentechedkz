"""Очередь заявок на доступ: данные формы /join, подсказка матчинга, решение.

Revision ID: 087
Revises: 086
Create Date: 2026-09-02
"""
from alembic import op
import sqlalchemy as sa

revision = "087"
down_revision = "086"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Только новая таблица: users и students не трогаем. Enum-типов не заводим —
    # status держим строкой с CHECK (см. докстринг модели: повторный CREATE TYPE
    # уже ломал нам прогон 085).
    op.create_table(
        "access_requests",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("requested_role", sa.String(length=20), nullable=False),
        sa.Column("full_name", sa.String(length=500), nullable=False),
        sa.Column("phone_raw", sa.String(length=50), nullable=False),
        sa.Column("phone_normalized", sa.String(length=50), nullable=False),
        sa.Column("city", sa.String(length=500), nullable=True),
        sa.Column("direction", sa.Text(), nullable=True),
        sa.Column(
            "suggested_student_id",
            sa.UUID(),
            sa.ForeignKey("students.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("suggested_confidence", sa.Numeric(4, 3), nullable=True),
        sa.Column("suggested_method", sa.String(length=30), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="new"),
        sa.Column(
            "decided_by",
            sa.UUID(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_ip", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('new', 'auto_approved', 'approved', 'rejected')",
            name="ck_access_request_status",
        ),
        sa.CheckConstraint(
            "requested_role IN ('student', 'mentor')",
            name="ck_access_request_requested_role",
        ),
        # Одна заявка на аккаунт: повторный /join тем же Google обязан обновить
        # существующую строку, а не удвоить очередь админа.
        sa.UniqueConstraint("user_id", name="uq_access_request_user"),
    )
    op.create_index("ix_access_requests_user_id", "access_requests", ["user_id"])
    op.create_index("ix_access_requests_status", "access_requests", ["status"])
    op.create_index(
        "ix_access_requests_phone_normalized", "access_requests", ["phone_normalized"]
    )


def downgrade() -> None:
    op.drop_table("access_requests")
