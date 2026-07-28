"""Require confirmation for automatically discovered Telegram groups.

Revision ID: 046
Revises: 045
Create Date: 2026-07-29
"""
from alembic import op
import sqlalchemy as sa


revision = "046"
down_revision = "045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("telegram_pairing_codes", sa.Column("candidate_chat_id", sa.Uuid(), nullable=True))
    op.add_column("telegram_pairing_codes", sa.Column("candidate_detected_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("telegram_pairing_codes", sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(
        "fk_telegram_pairing_codes_candidate_chat",
        "telegram_pairing_codes",
        "telegram_chats",
        ["candidate_chat_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_telegram_pairing_codes_candidate_chat_id",
        "telegram_pairing_codes",
        ["candidate_chat_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_telegram_pairing_codes_candidate_chat_id", table_name="telegram_pairing_codes")
    op.drop_constraint(
        "fk_telegram_pairing_codes_candidate_chat",
        "telegram_pairing_codes",
        type_="foreignkey",
    )
    op.drop_column("telegram_pairing_codes", "cancelled_at")
    op.drop_column("telegram_pairing_codes", "candidate_detected_at")
    op.drop_column("telegram_pairing_codes", "candidate_chat_id")
