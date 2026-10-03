"""Add independent deadlines to roadmap subtasks.

Revision ID: 099
Revises: 098
Create Date: 2026-10-02
"""
from alembic import op
import sqlalchemy as sa


revision = "099"
down_revision = "098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("template_subtasks", sa.Column("due_offset_days", sa.Integer(), nullable=True))
    op.add_column("roadmap_subtasks", sa.Column("due_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("roadmap_subtasks", "due_date")
    op.drop_column("template_subtasks", "due_offset_days")
