"""Add a per-application deadline.

У заявки не было своего дедлайна: даты жили только у справочников — текстовые
`universities.deadline_note` и `country_reference.submission_deadline_notes`.
Они общие и не машиночитаемые, поэтому по ним нельзя ни отсортировать, ни
напомнить. Здесь появляется конкретная дата подачи, за которой следит ментор.

Nullable без дефолта: у 188 существующих заявок даты нет и выдумывать её
нельзя. Пока поле пустое, карточка показывает справочный ориентир из вуза,
иначе из страны — с явной пометкой «справочно».

Revision ID: 067
Revises: 066
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("deadline", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("applications", "deadline")
