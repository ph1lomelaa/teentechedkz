"""Security incident registry for regulation stage 11."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "077"
down_revision = "076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    kind_enum = postgresql.ENUM("wrong_document", "data_leak", "compromised_password", "lost_device", "wrong_access", "unknown_chat_member", name="security_incident_kind")
    status_enum = postgresql.ENUM("open", "investigating", "resolved", "closed", name="security_incident_status")
    kind_enum.create(op.get_bind(), checkfirst=True)
    status_enum.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "security_incidents",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("kind", postgresql.ENUM("wrong_document", "data_leak", "compromised_password", "lost_device", "wrong_access", "unknown_chat_member", name="security_incident_kind", create_type=False), nullable=False),
        sa.Column("status", postgresql.ENUM("open", "investigating", "resolved", "closed", name="security_incident_status", create_type=False), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("remediation", sa.Text(), nullable=True),
        sa.Column("owner_id", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("resolved_by", sa.UUID(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("security_incidents")
    postgresql.ENUM(name="security_incident_status").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="security_incident_kind").drop(op.get_bind(), checkfirst=True)
