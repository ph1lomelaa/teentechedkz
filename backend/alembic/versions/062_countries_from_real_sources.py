"""Country reference: union of real catalog sources (Sheets 20 tabs + Tilda 18 countries).

Renames "Корея" -> "Южная Корея" (matches the real source naming), drops "НУ"
(Nazarbayev University — a specific school, not a country; was seeded here by
mistake), adds the remaining countries actually present in the university
catalog sources. See app/services/university_import.py and app/core/seed.py
for the full source discussion.

Revision ID: 062
Revises: 061
Create Date: 2026-08-05
"""
import uuid

from alembic import op
import sqlalchemy as sa

from app.core.country_flags_data import flag_for, code_for

revision = "062"
down_revision = "061"
branch_labels = None
depends_on = None

NEW_COUNTRIES = [
    {"country_name": "Австралия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Австрия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Великобритания", "vpp_required": True, "submission_deadline_notes": "Октябрь–Январь", "notes": "UCAS"},
    {"country_name": "Испания", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Катар", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Кипр", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Малайзия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Нидерланды", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "ОАЭ", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Польша", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Сингапур", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Турция", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Финляндия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
    {"country_name": "Чехия", "vpp_required": False, "submission_deadline_notes": "", "notes": ""},
]


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text("UPDATE country_reference SET country_name = 'Южная Корея' WHERE country_name = 'Корея'"))
    conn.execute(sa.text("DELETE FROM country_reference WHERE country_name = 'НУ'"))

    country_reference = sa.table(
        "country_reference",
        sa.column("id", sa.Uuid()),
        sa.column("country_name", sa.String()),
        sa.column("vpp_required", sa.Boolean()),
        sa.column("submission_deadline_notes", sa.String()),
        sa.column("notes", sa.Text()),
        sa.column("code", sa.String()),
        sa.column("flag_emoji", sa.String()),
        sa.column("flag_url", sa.String()),
        sa.column("degree_levels", sa.JSON()),
    )

    existing = {
        row[0] for row in conn.execute(sa.text("SELECT country_name FROM country_reference")).fetchall()
    }
    for country in NEW_COUNTRIES:
        if country["country_name"] in existing:
            continue
        emoji, url = flag_for(country["country_name"])
        conn.execute(
            country_reference.insert().values(
                id=uuid.uuid4(),
                code=code_for(country["country_name"]),
                flag_emoji=emoji,
                flag_url=url,
                degree_levels=["undergraduate", "graduate"],
                **country,
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    names = [c["country_name"] for c in NEW_COUNTRIES]
    conn.execute(
        sa.text("DELETE FROM country_reference WHERE country_name = ANY(:names)"),
        {"names": names},
    )
    conn.execute(sa.text("UPDATE country_reference SET country_name = 'Корея' WHERE country_name = 'Южная Корея'"))
