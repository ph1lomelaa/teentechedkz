"""Онбординг: Student.work_phone + emergency_contacts (регламент МЗК п.3.2, п.3.4).

Revision ID: 054
Revises: 053
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "054"
down_revision = "053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("students", sa.Column("work_phone", sa.String(length=100), nullable=True))

    op.create_table(
        "emergency_contacts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("full_name", sa.String(length=300), nullable=False),
        sa.Column("relation", sa.String(length=200), nullable=True),
        sa.Column("phone", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_emergency_contacts_student_id", "emergency_contacts", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_emergency_contacts_student_id", table_name="emergency_contacts")
    op.drop_table("emergency_contacts")
    op.drop_column("students", "work_phone")
