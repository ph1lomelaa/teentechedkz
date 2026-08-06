"""Store the manager-controlled Telegram onboarding message."""
from alembic import op
import sqlalchemy as sa

revision = "078"
down_revision = "077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("telegram_chats", sa.Column("onboarding_message_id", sa.Integer(), nullable=True))
    op.add_column("telegram_chats", sa.Column("onboarding_text", sa.Text(), nullable=True))
    op.add_column("telegram_chats", sa.Column("onboarding_updated_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("telegram_chats", "onboarding_updated_at")
    op.drop_column("telegram_chats", "onboarding_text")
    op.drop_column("telegram_chats", "onboarding_message_id")