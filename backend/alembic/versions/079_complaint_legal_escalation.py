"""Track complaint risk and legal escalation."""
from alembic import op
import sqlalchemy as sa

revision = "079"
down_revision = "078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("complaints", sa.Column("risk_level", sa.String(length=20), nullable=False, server_default="normal"))
    op.add_column("complaints", sa.Column("legal_escalated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("complaints", sa.Column("legal_escalation_reason", sa.Text(), nullable=True))
    op.alter_column("complaints", "risk_level", server_default=None)


def downgrade() -> None:
    op.drop_column("complaints", "legal_escalation_reason")
    op.drop_column("complaints", "legal_escalated_at")
    op.drop_column("complaints", "risk_level")