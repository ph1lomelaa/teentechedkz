"""Student university shortlist — "избранные вузы" shared by student and mentor.

Until now nothing linked a student to the catalog: `applications.university` is
free text, and the student portal showed a student no target list at all. This
table is the wishlist both sides build together, deliberately separate from
`applications` (which tracks the submission process) so the two don't drift.

`university_id` cascades rather than SET NULLs — unlike university_credentials,
a shortlist row pointing at a deleted university carries no information.

Revision ID: 064
Revises: 063
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "student_universities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("university_id", sa.Uuid(), sa.ForeignKey("universities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("added_by_role", sa.String(length=20), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("student_id", "university_id", name="uq_student_university"),
    )
    op.create_index("ix_student_universities_student_id", "student_universities", ["student_id"])
    op.create_index("ix_student_universities_university_id", "student_universities", ["university_id"])


def downgrade() -> None:
    op.drop_index("ix_student_universities_university_id", table_name="student_universities")
    op.drop_index("ix_student_universities_student_id", table_name="student_universities")
    op.drop_table("student_universities")
