"""Universities catalog + encrypted university credentials

Revision ID: 016
Revises: 015
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "universities",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("country_ref_id", sa.Uuid(), sa.ForeignKey("country_reference.id", ondelete="SET NULL"), nullable=True),
        sa.Column("country_name", sa.String(200), nullable=True),
        sa.Column("name", sa.String(400), nullable=False),
        sa.Column("city", sa.String(200), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("website", sa.String(500), nullable=False, server_default=""),
        sa.Column("world_ranking", sa.Integer(), nullable=True),
        sa.Column("tuition_range", sa.String(200), nullable=False, server_default=""),
        sa.Column("has_grants", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_universities_name", "universities", ["name"])

    op.create_table(
        "university_credentials",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("student_id", sa.Uuid(), sa.ForeignKey("students.id", ondelete="CASCADE"), nullable=False),
        sa.Column("university_id", sa.Uuid(), sa.ForeignKey("universities.id", ondelete="SET NULL"), nullable=True),
        sa.Column("portal_name", sa.String(300), nullable=False),
        sa.Column("login_enc", sa.Text(), nullable=False),
        sa.Column("password_enc", sa.Text(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_university_credentials_student_id", "university_credentials", ["student_id"])


def downgrade() -> None:
    op.drop_table("university_credentials")
    op.drop_table("universities")
