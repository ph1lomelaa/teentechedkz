"""Service deadlines and operating links

Revision ID: 020
Revises: 019
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    service_columns = {c["name"] for c in inspector.get_columns("services")}
    if "deadline" not in service_columns:
        op.add_column("services", sa.Column("deadline", sa.Date(), nullable=True))

    for table in ("student_tasks", "documents", "student_notes", "meetings"):
        columns = {c["name"] for c in inspector.get_columns(table)}
        if "service_id" not in columns:
            op.add_column(table, sa.Column("service_id", sa.Uuid(), nullable=True))
        indexes = {i["name"] for i in inspector.get_indexes(table)}
        if f"ix_{table}_service_id" not in indexes:
            op.create_index(f"ix_{table}_service_id", table, ["service_id"])
        fks = {fk["name"] for fk in inspector.get_foreign_keys(table)}
        if f"fk_{table}_service_id_services" not in fks:
            op.create_foreign_key(
                f"fk_{table}_service_id_services",
                table,
                "services",
                ["service_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    for table in ("meetings", "student_notes", "documents", "student_tasks"):
        op.drop_constraint(f"fk_{table}_service_id_services", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_service_id", table_name=table)
        op.drop_column(table, "service_id")

    op.drop_column("services", "deadline")
