"""University: fields parsed from the Tilda product body + tri-state grants.

Only 88 of 200 catalog rows matched the finance spreadsheet, so city/tuition/
website were empty on most cards. The Tilda product body covers the whole
catalog and carries city, faculties, requirements and deadline prose — these
columns hold that parsed content (see app/services/tilda_text_parser.py).

`has_grants_status` supersedes the `has_grants` boolean, which forced "no data"
to display as "no grants". The boolean is left in place and kept in sync for
existing consumers; dropping it is a separate, later migration.

All columns are additive with defaults — no data rewrite, reversible.

Revision ID: 063
Revises: 062
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "063"
down_revision = "062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("universities", sa.Column("faculties", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("universities", sa.Column("requirements", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("universities", sa.Column("description_full", sa.Text(), nullable=False, server_default=""))
    op.add_column("universities", sa.Column("deadline_note", sa.Text(), nullable=False, server_default=""))
    op.add_column("universities", sa.Column("deadline_year_mentioned", sa.Integer(), nullable=True))
    op.add_column(
        "universities",
        sa.Column("has_grants_status", sa.String(length=20), nullable=False, server_default="unknown"),
    )
    # Text: some cells list every named scholarship with its URL.
    op.add_column("universities", sa.Column("grant_note", sa.Text(), nullable=False, server_default=""))
    op.add_column(
        "universities",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # Existing rows: the boolean is all we know, so map true -> "yes" and leave
    # everything else "unknown" rather than asserting "no grants" — the next
    # import re-derives the real value from the spreadsheet.
    op.execute("UPDATE universities SET has_grants_status = 'yes' WHERE has_grants IS TRUE")


def downgrade() -> None:
    op.drop_column("universities", "updated_at")
    op.drop_column("universities", "grant_note")
    op.drop_column("universities", "has_grants_status")
    op.drop_column("universities", "deadline_year_mentioned")
    op.drop_column("universities", "deadline_note")
    op.drop_column("universities", "description_full")
    op.drop_column("universities", "requirements")
    op.drop_column("universities", "faculties")
