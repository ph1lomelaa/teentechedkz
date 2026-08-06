"""Add contract addenda and structured complaint workflow.

Revision ID: 075
Revises: 074
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "075"
down_revision = "074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    addendum_status = postgresql.ENUM(
        "draft", "sent_to_customer", "customer_signed", "company_signed", "active",
        "renewal_due", "completed", "cancelled", name="addendum_status", create_type=False
    )
    addendum_status.create(op.get_bind(), checkfirst=True)
    op.create_table(
        "contract_addenda",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("contract_id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("number", sa.String(length=80), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("current_intake", sa.String(length=80), nullable=True),
        sa.Column("new_intake", sa.String(length=80), nullable=True),
        sa.Column("country_name", sa.String(length=200), nullable=True),
        sa.Column("programs", sa.JSON(), nullable=True),
        sa.Column("transfer_start", sa.Date(), nullable=True),
        sa.Column("transfer_end", sa.Date(), nullable=True),
        sa.Column("resume_date", sa.Date(), nullable=True),
        sa.Column("contract_expires_at", sa.Date(), nullable=True),
        sa.Column("related_service_ids", sa.JSON(), nullable=True),
        sa.Column("related_task_ids", sa.JSON(), nullable=True),
        sa.Column("status", addendum_status, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("document_hash", sa.String(length=128), nullable=True),
        sa.Column("customer_signed_by", sa.Uuid(), nullable=True),
        sa.Column("customer_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("company_signed_by", sa.Uuid(), nullable=True),
        sa.Column("company_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["customer_signed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_signed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("number"),
    )
    op.create_index("ix_contract_addenda_contract_id", "contract_addenda", ["contract_id"])
    op.create_index("ix_contract_addenda_student_id", "contract_addenda", ["student_id"])
    op.create_index("ix_contract_addenda_status", "contract_addenda", ["status"])

    applicant_type = postgresql.ENUM("student", "parent", "employee", "other", name="complaint_applicant_type", create_type=False)
    category = postgresql.ENUM(
        "student", "parent", "deadline", "quality", "specialist_change", "communication",
        "refund", "suggestion", "other", name="complaint_category", create_type=False
    )
    applicant_type.create(op.get_bind(), checkfirst=True)
    category.create(op.get_bind(), checkfirst=True)
    op.add_column("complaints", sa.Column("applicant_type", applicant_type, nullable=True))
    op.add_column("complaints", sa.Column("category", category, nullable=True))
    op.add_column("complaints", sa.Column("original_body", sa.Text(), nullable=True))
    op.add_column("complaints", sa.Column("intermediate_answer", sa.Text(), nullable=True))
    op.add_column("complaints", sa.Column("final_answer", sa.Text(), nullable=True))
    op.add_column("complaints", sa.Column("decision", sa.Text(), nullable=True))
    op.add_column("complaints", sa.Column("confirmation", sa.Text(), nullable=True))
    op.execute("UPDATE complaints SET applicant_type = 'student' WHERE applicant_type IS NULL")
    op.execute("UPDATE complaints SET category = 'other' WHERE category IS NULL")
    op.execute("UPDATE complaints SET original_body = body WHERE original_body IS NULL")
    op.alter_column("complaints", "applicant_type", nullable=False, server_default="student")
    op.alter_column("complaints", "category", nullable=False, server_default="other")
    op.alter_column("complaints", "original_body", nullable=False)


def downgrade() -> None:
    op.drop_column("complaints", "confirmation")
    op.drop_column("complaints", "decision")
    op.drop_column("complaints", "final_answer")
    op.drop_column("complaints", "intermediate_answer")
    op.drop_column("complaints", "original_body")
    op.drop_column("complaints", "category")
    op.drop_column("complaints", "applicant_type")
    sa.Enum(name="complaint_category").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="complaint_applicant_type").drop(op.get_bind(), checkfirst=True)
    op.drop_index("ix_contract_addenda_status", table_name="contract_addenda")
    op.drop_index("ix_contract_addenda_student_id", table_name="contract_addenda")
    op.drop_index("ix_contract_addenda_contract_id", table_name="contract_addenda")
    op.drop_table("contract_addenda")
    sa.Enum(name="addendum_status").drop(op.get_bind(), checkfirst=True)
