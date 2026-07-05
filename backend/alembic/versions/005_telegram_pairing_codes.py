"""Telegram pairing codes for deep-link chat binding

Revision ID: 005
Revises: 004
Create Date: 2026-07-03
"""
from alembic import op
import sqlalchemy as sa

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "telegram_pairing_codes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_telegram_pairing_codes_code", "telegram_pairing_codes", ["code"])


def downgrade() -> None:
    op.drop_index("ix_telegram_pairing_codes_code", table_name="telegram_pairing_codes")
    op.drop_table("telegram_pairing_codes")
