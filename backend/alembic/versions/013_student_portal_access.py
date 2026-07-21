"""Student portal access: student role, students.user_id bridge, last_login_at

Adds the client-facing `student` role, links a students record to a login
account (`students.user_id`), tracks last login, and collapses the mentor
tier by merging `lead_mentor` into `mentor`.

Revision ID: 013
Revises: 012
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. New enum value `student`. ALTER TYPE ... ADD VALUE cannot run inside a
    #    transaction, so use Alembic's autocommit block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'student'")

    # 2. Bridge: link a student card to a login account (nullable, unique).
    op.add_column("students", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint("uq_students_user_id", "students", ["user_id"])
    op.create_foreign_key(
        "fk_students_user_id_users", "students", "users",
        ["user_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_students_user_id", "students", ["user_id"])

    # 3. Track last login (shown in the CRM «Кабинет» tab).
    op.add_column(
        "users",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 4. Collapse mentor tier: existing lead_mentor accounts become mentor.
    op.execute("UPDATE users SET role = 'mentor' WHERE role = 'lead_mentor'")


def downgrade() -> None:
    op.drop_index("ix_students_user_id", table_name="students")
    op.drop_constraint("fk_students_user_id_users", "students", type_="foreignkey")
    op.drop_constraint("uq_students_user_id", "students", type_="unique")
    op.drop_column("students", "user_id")
    op.drop_column("users", "last_login_at")
    # Note: the `student` enum value and the lead_mentor→mentor data merge are
    # not reverted (Postgres cannot drop an enum value without recreating the type).
