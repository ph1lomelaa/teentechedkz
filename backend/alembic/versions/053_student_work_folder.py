"""Student.work_folder_url (регламент МЗК п.2.2 — ссылка на рабочую папку студента).

Revision ID: 053
Revises: 052
Create Date: 2026-08-04
"""
from alembic import op
import sqlalchemy as sa

revision = "053"
down_revision = "052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("students", sa.Column("work_folder_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    op.drop_column("students", "work_folder_url")
