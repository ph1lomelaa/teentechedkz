"""Student task-completion claims + mentor review axis on roadmap_tasks

status stays the mentor-owned canonical truth ('done' = mentor-confirmed);
review_status carries the student's claim lifecycle: none/pending/approved/returned.

Revision ID: 043
Revises: 042
Create Date: 2026-07-25
"""
import sqlalchemy as sa
from alembic import op

revision = "043"
down_revision = "042"
branch_labels = None
depends_on = None

_review_enum = sa.Enum("none", "pending", "approved", "returned", name="task_review_status")


def upgrade() -> None:
    _review_enum.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "roadmap_tasks",
        sa.Column("review_status", _review_enum, nullable=False, server_default="none"),
    )
    op.add_column(
        "roadmap_tasks",
        sa.Column("completed_by", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "roadmap_tasks",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "roadmap_tasks",
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "roadmap_tasks",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "roadmap_tasks",
        sa.Column("review_comment", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_roadmap_tasks_completed_by",
        "roadmap_tasks",
        "users",
        ["completed_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_roadmap_tasks_reviewed_by",
        "roadmap_tasks",
        "users",
        ["reviewed_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_roadmap_tasks_review_pending",
        "roadmap_tasks",
        ["roadmap_id"],
        postgresql_where=sa.text("review_status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("ix_roadmap_tasks_review_pending", table_name="roadmap_tasks")
    op.drop_constraint("fk_roadmap_tasks_reviewed_by", "roadmap_tasks", type_="foreignkey")
    op.drop_constraint("fk_roadmap_tasks_completed_by", "roadmap_tasks", type_="foreignkey")
    op.drop_column("roadmap_tasks", "review_comment")
    op.drop_column("roadmap_tasks", "reviewed_at")
    op.drop_column("roadmap_tasks", "reviewed_by")
    op.drop_column("roadmap_tasks", "completed_at")
    op.drop_column("roadmap_tasks", "completed_by")
    op.drop_column("roadmap_tasks", "review_status")
    _review_enum.drop(op.get_bind(), checkfirst=True)
