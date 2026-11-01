"""Роль finance_manager, график платежей и журнал изменений денег из Notion.

Revision ID: 126
Revises: 125
Create Date: 2026-11-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "126"
down_revision = "125"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE нельзя внутри транзакции.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'finance_manager'")

    op.create_table(
        "payment_schedule_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("main", "english", "portfolio", "proforientation", "ielts_fee", "other", name="schedule_kind"),
            server_default="main",
            nullable=False,
        ),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(10), server_default="KZT", nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_payment_schedule_items_contract_id", "payment_schedule_items", ["contract_id"])
    op.create_index("ix_payment_schedule_items_student_id", "payment_schedule_items", ["student_id"])
    op.create_index("ix_payment_schedule_items_due_date", "payment_schedule_items", ["due_date"])

    op.add_column("payments", sa.Column("schedule_item_id", postgresql.UUID(as_uuid=True), nullable=True))
    # add_column, в отличие от create_table, тип enum сам не создаёт.
    postgresql.ENUM("kaspi", "bank", "cash", "other", name="payment_method").create(op.get_bind(), checkfirst=True)
    op.add_column(
        "payments",
        sa.Column("method", postgresql.ENUM(name="payment_method", create_type=False), nullable=True),
    )
    op.create_foreign_key(
        "fk_payments_schedule_item_id", "payments", "payment_schedule_items",
        ["schedule_item_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_payments_schedule_item_id", "payments", ["schedule_item_id"])

    op.create_table(
        "finance_change_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("contract_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("field", sa.String(40), nullable=False),
        sa.Column("old_value", sa.String(200), nullable=True),
        sa.Column("new_value", sa.String(200), nullable=True),
        sa.Column("source", sa.String(20), server_default="notion", nullable=False),
        sa.Column(
            "status",
            sa.Enum("new", "accepted", "kept", name="finance_change_status"),
            server_default="new",
            nullable=False,
        ),
        sa.Column("source_ref", sa.String(160), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("schedule_item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["contract_id"], ["contracts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["schedule_item_id"], ["payment_schedule_items.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("source_ref", name="uq_finance_change_events_source_ref"),
    )
    op.create_index("ix_finance_change_events_notified_at", "finance_change_events", ["notified_at"])
    op.create_index("ix_finance_change_events_student_id", "finance_change_events", ["student_id"])
    op.create_index("ix_finance_change_events_status", "finance_change_events", ["status"])
    op.create_index("ix_finance_change_events_created_at", "finance_change_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("finance_change_events")
    # Ключ и индекс уходят вместе с колонкой. Явный drop_constraint падал на
    # базе из bootstrap_db: create_all называет ключ по-своему.
    op.drop_column("payments", "method")
    op.drop_column("payments", "schedule_item_id")
    op.drop_table("payment_schedule_items")
    sa.Enum(name="finance_change_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="payment_method").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="schedule_kind").drop(op.get_bind(), checkfirst=True)
    # Значение finance_manager в user_role Postgres удалить не умеет — оно безвредно.
