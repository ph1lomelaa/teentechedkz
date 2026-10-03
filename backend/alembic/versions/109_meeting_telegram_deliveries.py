"""Durable Telegram delivery state for scheduled meetings."""
from alembic import op
import sqlalchemy as sa

revision = "109"
down_revision = "108"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meeting_telegram_deliveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(80), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=True),
        sa.Column("telegram_message_id", sa.BigInteger(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("meeting_id", "kind", name="uq_meeting_telegram_kind"),
    )
    op.create_index("ix_meeting_telegram_deliveries_meeting_id", "meeting_telegram_deliveries", ["meeting_id"])


def downgrade() -> None:
    op.drop_index("ix_meeting_telegram_deliveries_meeting_id", table_name="meeting_telegram_deliveries")
    op.drop_table("meeting_telegram_deliveries")
