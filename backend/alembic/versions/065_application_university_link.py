"""Link an application to the university catalog.

`applications.university` is free text (String(500)) and stays: it is the only
thing 188 existing rows have, and a mentor must still be able to type a
university that is not in the catalog yet. The new `university_id` is an
optional pointer alongside it — when set, the UI can show a photo, a country
flag and a link to the university page instead of a bare string.

SET NULL rather than CASCADE: deleting a university from the catalog must not
delete a student's application — the process is real regardless of whether we
still carry that university in the reference book. The free-text `university`
survives such a delete and keeps the row meaningful.

This is the first alembic revision to touch `applications`; the table itself
predates the migration chain (created by app/core/create_tables.py).

Revision ID: 065
Revises: 064
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "applications",
        sa.Column("university_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_applications_university_id",
        "applications",
        "universities",
        ["university_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_applications_university_id", "applications", ["university_id"])
    # Заявки всегда читаются по студенту (карточка, портал), но индекса не было.
    op.create_index("ix_applications_student_id", "applications", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_applications_student_id", table_name="applications")
    op.drop_index("ix_applications_university_id", table_name="applications")
    op.drop_constraint("fk_applications_university_id", "applications", type_="foreignkey")
    op.drop_column("applications", "university_id")
