"""Add task submission and review metadata.

Revision ID: 072
Revises: 071
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "072"
down_revision = "071"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_tasks", sa.Column("result_text", sa.Text(), nullable=True))
    op.add_column("student_tasks", sa.Column("evidence_documents", sa.JSON(), nullable=True))
    op.add_column("student_tasks", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("student_tasks", sa.Column("submitted_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_student_tasks_submitted_by_users",
        "student_tasks",
        "users",
        ["submitted_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("student_tasks", sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("student_tasks", sa.Column("accepted_by", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_student_tasks_accepted_by_users",
        "student_tasks",
        "users",
        ["accepted_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("student_tasks", sa.Column("review_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("student_tasks", "review_note")
    op.drop_constraint("fk_student_tasks_accepted_by_users", "student_tasks", type_="foreignkey")
    op.drop_column("student_tasks", "accepted_by")
    op.drop_column("student_tasks", "accepted_at")
    op.drop_constraint("fk_student_tasks_submitted_by_users", "student_tasks", type_="foreignkey")
    op.drop_column("student_tasks", "submitted_by")
    op.drop_column("student_tasks", "submitted_at")
    op.drop_column("student_tasks", "evidence_documents")
    op.drop_column("student_tasks", "result_text")
