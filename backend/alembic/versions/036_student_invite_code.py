"""Short human-typeable code alongside the invite link (activation without a URL).

Revision ID: 036
Revises: 035
Create Date: 2026-07-21
"""
from alembic import op
import sqlalchemy as sa

revision = "036"
down_revision = "035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("student_invites", sa.Column("code_hash", sa.String(length=64), nullable=True))
    op.create_index(
        "ix_student_invites_code_hash", "student_invites", ["code_hash"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_student_invites_code_hash", table_name="student_invites")
    op.drop_column("student_invites", "code_hash")
