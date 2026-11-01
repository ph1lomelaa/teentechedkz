"""Service acts, immutable PDF snapshots, mail audit."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "128"
down_revision = "127"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("service_acts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("student_id", UUID(as_uuid=True), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_link_id", UUID(as_uuid=True), sa.ForeignKey("trustme_contract_links.id", ondelete="SET NULL")),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("template_version", sa.String(30), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("file_name", sa.String(500)), sa.Column("storage_path", sa.Text()),
        sa.Column("supersedes_id", UUID(as_uuid=True), sa.ForeignKey("service_acts.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True)),
        sa.Column("shared_at", sa.DateTime(timezone=True)))
    op.create_index("ix_service_acts_student_id", "service_acts", ["student_id"])
    op.create_table("act_mail_attempts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("act_id", UUID(as_uuid=True), sa.ForeignKey("service_acts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sent_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("recipient", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(500), nullable=False), sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False), sa.Column("message_id", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)))
    op.create_index("ix_act_mail_attempts_act_id", "act_mail_attempts", ["act_id"])


def downgrade():
    op.drop_table("act_mail_attempts")
    op.drop_table("service_acts")
