"""Add task assignee and agreement-aware workflow statuses.

Revision ID: 069
Revises: 068
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None


WORKFLOW_STATUSES = (
    "awaiting_signature",
    "in_progress",
    "submitted",
    "needs_revision",
    "accepted",
    "blocked_by_agreement",
    "overdue",
    "cancelled",
)


def upgrade() -> None:
    # PostgreSQL enum values are additive here so existing open/done tasks remain
    # valid and old deployments can be upgraded without rewriting task rows.
    for value in WORKFLOW_STATUSES:
        op.execute(
            sa.text(
                "ALTER TYPE task_status ADD VALUE IF NOT EXISTS "
                f"'{value}'"
            )
        )

    op.add_column(
        "student_tasks",
        sa.Column(
            "assignee_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_student_tasks_assignee_id", "student_tasks", ["assignee_id"])


def downgrade() -> None:
    op.drop_index("ix_student_tasks_assignee_id", table_name="student_tasks")
    op.drop_column("student_tasks", "assignee_id")
    # PostgreSQL does not safely remove enum values in-place. The added values
    # are harmless after the nullable assignment column is removed.
