"""Meeting type, outcome, and note-session link

Revision ID: 019
Revises: 018
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None

meeting_type_vals = ("intro", "regular", "documents", "roadmap", "application", "finance", "other")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    sa.Enum(*meeting_type_vals, name="meeting_type").create(bind, checkfirst=True)

    meeting_columns = {c["name"] for c in inspector.get_columns("meetings")}
    if "meeting_type" not in meeting_columns:
        op.add_column(
            "meetings",
            sa.Column(
                "meeting_type",
                PGEnum(*meeting_type_vals, name="meeting_type", create_type=False),
                nullable=False,
                server_default="regular",
            ),
        )
    if "outcome" not in meeting_columns:
        op.add_column("meetings", sa.Column("outcome", sa.Text(), nullable=False, server_default=""))

    note_columns = {c["name"] for c in inspector.get_columns("note_sessions")}
    if "meeting_id" not in note_columns:
        op.add_column("note_sessions", sa.Column("meeting_id", sa.Uuid(), nullable=True))
    indexes = {i["name"] for i in inspector.get_indexes("note_sessions")}
    if "ix_note_sessions_meeting_id" not in indexes:
        op.create_index("ix_note_sessions_meeting_id", "note_sessions", ["meeting_id"])
    uniques = {u["name"] for u in inspector.get_unique_constraints("note_sessions")}
    if "uq_note_sessions_meeting_id" not in uniques:
        op.create_unique_constraint("uq_note_sessions_meeting_id", "note_sessions", ["meeting_id"])
    fks = {fk["name"] for fk in inspector.get_foreign_keys("note_sessions")}
    if "fk_note_sessions_meeting_id_meetings" not in fks:
        op.create_foreign_key(
            "fk_note_sessions_meeting_id_meetings",
            "note_sessions",
            "meetings",
            ["meeting_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    op.drop_constraint("fk_note_sessions_meeting_id_meetings", "note_sessions", type_="foreignkey")
    op.drop_constraint("uq_note_sessions_meeting_id", "note_sessions", type_="unique")
    op.drop_index("ix_note_sessions_meeting_id", table_name="note_sessions")
    op.drop_column("note_sessions", "meeting_id")

    op.drop_column("meetings", "outcome")
    op.drop_column("meetings", "meeting_type")
    op.execute("DROP TYPE IF EXISTS meeting_type")
