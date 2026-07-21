"""Publish student notes to the portal (Приоритет 3).

Revision ID: 029
Revises: 028
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "029"
down_revision = "028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "student_notes",
        sa.Column("published_to_student", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("student_notes", sa.Column("published_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("student_notes", sa.Column("published_by", sa.Uuid(), nullable=True))
    op.add_column("student_notes", sa.Column("student_title", sa.Text(), nullable=True))
    op.add_column(
        "student_notes",
        sa.Column("hidden_blocks", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.create_foreign_key(
        "fk_student_notes_published_by_users",
        "student_notes",
        "users",
        ["published_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_student_notes_published",
        "student_notes",
        ["student_id", "published_to_student"],
    )


def downgrade() -> None:
    op.drop_index("ix_student_notes_published", table_name="student_notes")
    op.drop_constraint("fk_student_notes_published_by_users", "student_notes", type_="foreignkey")
    op.drop_column("student_notes", "hidden_blocks")
    op.drop_column("student_notes", "student_title")
    op.drop_column("student_notes", "published_by")
    op.drop_column("student_notes", "published_at")
    op.drop_column("student_notes", "published_to_student")
