"""Electronic agreement signing (ОС 30/07, Блок C).

Simple electronic signature + document hash, not ЭЦП НУЦ РК (see plan § 5.2:
NCALayer doesn't work on phones, some minor students have no ЭЦП key; Digital
Code RK art. 47 allows a simple signature for civil-law contracts with consent).

Revision ID: 048
Revises: 047
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    agreement_audience = postgresql.ENUM("mentor", "student", "mzk", name="agreement_audience", create_type=False)
    agreement_status = postgresql.ENUM("draft", "published", "archived", name="agreement_status", create_type=False)
    agreement_audience.create(op.get_bind(), checkfirst=True)
    agreement_status.create(op.get_bind(), checkfirst=True)

    if not inspector.has_table("agreements"):
        op.create_table(
            "agreements",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("audience", agreement_audience, nullable=False),
            sa.Column("status", agreement_status, nullable=False, server_default="draft"),
            sa.Column("body_markdown", sa.Text(), nullable=True),
            sa.Column("file_storage_path", sa.String(2048), nullable=True),
            sa.Column("file_name", sa.String(500), nullable=True),
            sa.Column("file_mime_type", sa.String(100), nullable=True),
            sa.Column("document_sha256", sa.String(64), nullable=True),
            sa.Column("country_name", sa.String(200), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )
    agreement_indexes = {index["name"] for index in inspector.get_indexes("agreements")} if inspector.has_table("agreements") else set()
    if "ix_agreements_audience" not in agreement_indexes:
        op.create_index("ix_agreements_audience", "agreements", ["audience"])
    if "ix_agreements_status" not in agreement_indexes:
        op.create_index("ix_agreements_status", "agreements", ["status"])

    if not inspector.has_table("agreement_signatures"):
        op.create_table(
            "agreement_signatures",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("agreement_id", sa.Uuid(), sa.ForeignKey("agreements.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("signed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("ip", sa.String(64), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("full_name_typed", sa.String(300), nullable=False),
            sa.Column("checkbox_acknowledged", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("document_sha256", sa.String(64), nullable=True),
            sa.Column("agreement_version", sa.Integer(), nullable=False),
        )
    signature_indexes = {index["name"] for index in inspector.get_indexes("agreement_signatures")} if inspector.has_table("agreement_signatures") else set()
    if "ix_agreement_signatures_agreement_id" not in signature_indexes:
        op.create_index("ix_agreement_signatures_agreement_id", "agreement_signatures", ["agreement_id"])
    if "ix_agreement_signatures_user_id" not in signature_indexes:
        op.create_index("ix_agreement_signatures_user_id", "agreement_signatures", ["user_id"])
    # EXISTS(user_id, agreement_id) — тот самый индекс для проверки подписи на
    # каждом запросе (§ 5.3 плана), без него это лишний seq scan под нагрузкой.
    if "ix_agreement_signatures_user_agreement" not in signature_indexes:
        op.create_index("ix_agreement_signatures_user_agreement", "agreement_signatures", ["user_id", "agreement_id"])


def downgrade() -> None:
    op.drop_index("ix_agreement_signatures_user_agreement", table_name="agreement_signatures")
    op.drop_index("ix_agreement_signatures_user_id", table_name="agreement_signatures")
    op.drop_index("ix_agreement_signatures_agreement_id", table_name="agreement_signatures")
    op.drop_table("agreement_signatures")
    op.drop_index("ix_agreements_status", table_name="agreements")
    op.drop_index("ix_agreements_audience", table_name="agreements")
    op.drop_table("agreements")

    agreement_status = sa.Enum(name="agreement_status")
    agreement_audience = sa.Enum(name="agreement_audience")
    agreement_status.drop(op.get_bind(), checkfirst=True)
    agreement_audience.drop(op.get_bind(), checkfirst=True)
