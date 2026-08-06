"""Add task evidence uploads.

Revision ID: 073
Revises: 072
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "073"
down_revision = "072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_evidence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("uploaded_by", sa.Uuid(), nullable=False),
        sa.Column("file_name", sa.String(length=500), nullable=False),
        sa.Column("requirement", sa.String(length=500), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("storage_path", sa.String(length=2048), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["student_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_task_evidence_task_id", "task_evidence", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_task_evidence_task_id", table_name="task_evidence")
    op.drop_table("task_evidence")
