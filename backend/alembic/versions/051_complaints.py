"""Книга жалоб и рекомендаций (ОС 30/07, Блок D).

visible_to_role reuses the existing note_visibility enum type (ConfidentialNote)
instead of creating a duplicate — same three-tier staff visibility model.

Revision ID: 051
Revises: 050
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    complaint_kind = postgresql.ENUM("complaint", "recommendation", name="complaint_kind", create_type=False)
    complaint_status = postgresql.ENUM("new", "in_progress", "answered", "closed", name="complaint_status", create_type=False)
    complaint_kind.create(op.get_bind(), checkfirst=True)
    complaint_status.create(op.get_bind(), checkfirst=True)

    note_visibility = postgresql.ENUM("admin_only", "admin_and_mzk", "all_mentors", name="note_visibility", create_type=False)

    op.create_table(
        "complaints",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("author_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="SET NULL"), nullable=True),
        sa.Column("kind", complaint_kind, nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("status", complaint_status, nullable=False, server_default="new"),
        sa.Column("assigned_to", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("visible_to_role", note_visibility, nullable=False, server_default="admin_only"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_sla_breached", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_complaints_student_id", "complaints", ["student_id"])
    op.create_index("ix_complaints_status", "complaints", ["status"])
    op.create_index("ix_complaints_created_at", "complaints", ["created_at"])
    op.create_index("ix_complaints_is_sla_breached", "complaints", ["is_sla_breached"])
    # Цикл проверки выбирает только status IN (new, in_progress) — составной
    # индекс под этот запрос (§ Блок D плана).
    op.create_index("ix_complaints_status_created_at", "complaints", ["status", "created_at"])

    op.create_table(
        "complaint_replies",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("complaint_id", sa.Uuid(), sa.ForeignKey("complaints.id", ondelete="CASCADE"), nullable=False),
        sa.Column("author_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("visible_to_author", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.create_index("ix_complaint_replies_complaint_id", "complaint_replies", ["complaint_id"])


def downgrade() -> None:
    op.drop_index("ix_complaint_replies_complaint_id", table_name="complaint_replies")
    op.drop_table("complaint_replies")

    op.drop_index("ix_complaints_status_created_at", table_name="complaints")
    op.drop_index("ix_complaints_is_sla_breached", table_name="complaints")
    op.drop_index("ix_complaints_created_at", table_name="complaints")
    op.drop_index("ix_complaints_status", table_name="complaints")
    op.drop_index("ix_complaints_student_id", table_name="complaints")
    op.drop_table("complaints")

    complaint_status = sa.Enum(name="complaint_status")
    complaint_kind = sa.Enum(name="complaint_kind")
    complaint_status.drop(op.get_bind(), checkfirst=True)
    complaint_kind.drop(op.get_bind(), checkfirst=True)
