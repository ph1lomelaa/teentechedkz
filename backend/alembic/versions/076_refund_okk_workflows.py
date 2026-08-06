"""Complete refund and OКК workflows for regulation stages 9-10."""
from alembic import op
import sqlalchemy as sa

revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE refund_case_status RENAME TO refund_case_status_old")
    sa.Enum(
        "draft", "submitted", "registered", "under_review", "awaiting_documents",
        "awaiting_approval", "negotiation", "decision_made", "awaiting_execution",
        "executed", "rejected", "closed", name="refund_case_status",
    ).create(op.get_bind())
    op.execute(
        "ALTER TABLE refund_cases ALTER COLUMN status DROP DEFAULT"
    )
    op.execute(
        "ALTER TABLE refund_cases ALTER COLUMN status TYPE refund_case_status "
        "USING CASE status::text WHEN 'open' THEN 'registered' WHEN 'resolved' THEN 'closed' ELSE 'rejected' END::refund_case_status"
    )
    op.execute(
        "ALTER TABLE refund_cases ALTER COLUMN status SET DEFAULT 'draft'"
    )
    op.execute("DROP TYPE refund_case_status_old")

    for name, column in [
        ("applicant_name", sa.Column("applicant_name", sa.String(255), nullable=True)),
        ("payer_name", sa.Column("payer_name", sa.String(255), nullable=True)),
        ("reason", sa.Column("reason", sa.Text(), nullable=True)),
        ("provided_services", sa.Column("provided_services", sa.JSON(), nullable=False, server_default="[]")),
        ("outstanding_obligations", sa.Column("outstanding_obligations", sa.JSON(), nullable=False, server_default="[]")),
        ("specialist_explanations", sa.Column("specialist_explanations", sa.Text(), nullable=True)),
        ("correspondence", sa.Column("correspondence", sa.Text(), nullable=True)),
        ("calculation", sa.Column("calculation", sa.Text(), nullable=True)),
        ("level_criteria", sa.Column("level_criteria", sa.JSON(), nullable=False, server_default="{}")),
        ("decision", sa.Column("decision", sa.Text(), nullable=True)),
        ("approval_note", sa.Column("approval_note", sa.Text(), nullable=True)),
        ("approved_by", sa.Column("approved_by", sa.UUID(), nullable=True)),
        ("approved_at", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True)),
        ("execution_confirmation", sa.Column("execution_confirmation", sa.Text(), nullable=True)),
        ("bonus_paid_at", sa.Column("bonus_paid_at", sa.DateTime(timezone=True), nullable=True)),
    ]:
        op.add_column("refund_cases", column)
    op.create_foreign_key("fk_refund_cases_approved_by", "refund_cases", "users", ["approved_by"], ["id"], ondelete="SET NULL")

    op.add_column("mzk_reviews", sa.Column("source_key", sa.String(255), nullable=True))
    op.add_column("mzk_reviews", sa.Column("source_kind", sa.String(50), nullable=True))
    op.execute("UPDATE mzk_reviews SET source_key = 'legacy-' || id::text, source_kind = 'legacy'")
    op.alter_column("mzk_reviews", "source_key", nullable=False, server_default="manual")
    op.alter_column("mzk_reviews", "source_kind", nullable=False, server_default="manual")
    op.create_unique_constraint("uq_mzk_reviews_source_period", "mzk_reviews", ["mzk_manager_id", "period_year", "period_month", "source_key"])

    for name, column in [
        ("approved_by", sa.Column("approved_by", sa.UUID(), nullable=True)),
        ("approved_at", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True)),
        ("objection_text", sa.Column("objection_text", sa.String(2000), nullable=True)),
        ("objection_deadline", sa.Column("objection_deadline", sa.DateTime(timezone=True), nullable=True)),
    ]:
        op.add_column("mzk_quality_scores", column)
    op.create_foreign_key("fk_mzk_quality_scores_approved_by", "mzk_quality_scores", "users", ["approved_by"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_mzk_quality_scores_approved_by", "mzk_quality_scores", type_="foreignkey")
    for name in ("objection_deadline", "objection_text", "approved_at", "approved_by"):
        op.drop_column("mzk_quality_scores", name)
    op.drop_constraint("uq_mzk_reviews_source_period", "mzk_reviews", type_="unique")
    op.drop_column("mzk_reviews", "source_kind")
    op.drop_column("mzk_reviews", "source_key")
    op.drop_constraint("fk_refund_cases_approved_by", "refund_cases", type_="foreignkey")
    for name in ("bonus_paid_at", "execution_confirmation", "approved_at", "approved_by", "approval_note", "decision", "level_criteria", "calculation", "correspondence", "specialist_explanations", "outstanding_obligations", "provided_services", "reason", "payer_name", "applicant_name"):
        op.drop_column("refund_cases", name)
    op.execute("ALTER TYPE refund_case_status RENAME TO refund_case_status_new")
    sa.Enum("open", "resolved", "rejected", name="refund_case_status").create(op.get_bind())
    op.execute("ALTER TABLE refund_cases ALTER COLUMN status DROP DEFAULT")
    op.execute("ALTER TABLE refund_cases ALTER COLUMN status TYPE refund_case_status USING CASE status::text WHEN 'closed' THEN 'resolved' ELSE status::text END::refund_case_status")
    op.execute("DROP TYPE refund_case_status_new")
