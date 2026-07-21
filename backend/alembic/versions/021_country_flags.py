"""Country flag assets: country_reference += code, flag_emoji, flag_url

Adds donor-style flag columns and back-fills them for known country names
(flagcdn raster + emoji). Mapping is inlined to keep the migration self-contained;
keep it in sync with app/core/country_flags_data.py.

Revision ID: 021
Revises: 020
Create Date: 2026-07-19
"""
from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None

# lower(country_name) -> (code, emoji). flag_url derived as flagcdn w320 png.
_FLAGS: dict[str, tuple[str, str]] = {
    "венгрия": ("hu", "🇭🇺"),
    "ну": ("kz", "🇰🇿"),
    "назарбаев университет": ("kz", "🇰🇿"),
    "гонконг": ("hk", "🇭🇰"),
    "сша": ("us", "🇺🇸"),
    "корея": ("kr", "🇰🇷"),
    "южная корея": ("kr", "🇰🇷"),
    "китай": ("cn", "🇨🇳"),
    "италия": ("it", "🇮🇹"),
    "германия": ("de", "🇩🇪"),
    "канада": ("ca", "🇨🇦"),
    "казахстан": ("kz", "🇰🇿"),
    "великобритания": ("gb", "🇬🇧"),
    "малайзия": ("my", "🇲🇾"),
    "россия": ("ru", "🇷🇺"),
    "турция": ("tr", "🇹🇷"),
    "япония": ("jp", "🇯🇵"),
    "франция": ("fr", "🇫🇷"),
    "испания": ("es", "🇪🇸"),
    "нидерланды": ("nl", "🇳🇱"),
    "польша": ("pl", "🇵🇱"),
    "чехия": ("cz", "🇨🇿"),
    "австрия": ("at", "🇦🇹"),
    "швейцария": ("ch", "🇨🇭"),
    "австралия": ("au", "🇦🇺"),
    "оаэ": ("ae", "🇦🇪"),
    "сингапур": ("sg", "🇸🇬"),
    "финляндия": ("fi", "🇫🇮"),
    "швеция": ("se", "🇸🇪"),
    "норвегия": ("no", "🇳🇴"),
    "дания": ("dk", "🇩🇰"),
    "бельгия": ("be", "🇧🇪"),
    "ирландия": ("ie", "🇮🇪"),
    "новая зеландия": ("nz", "🇳🇿"),
}


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("country_reference")}
    if "code" not in columns:
        op.add_column("country_reference", sa.Column("code", sa.String(8), nullable=False, server_default=""))
    if "flag_emoji" not in columns:
        op.add_column("country_reference", sa.Column("flag_emoji", sa.String(16), nullable=False, server_default=""))
    if "flag_url" not in columns:
        op.add_column("country_reference", sa.Column("flag_url", sa.String(300), nullable=False, server_default=""))

    stmt = sa.text(
        "UPDATE country_reference SET code = :code, flag_emoji = :emoji, flag_url = :url "
        "WHERE lower(country_name) = :name AND (flag_url = '' OR flag_url IS NULL)"
    )
    for name, (code, emoji) in _FLAGS.items():
        bind.execute(stmt, {
            "code": code,
            "emoji": emoji,
            "url": f"https://flagcdn.com/w320/{code}.png",
            "name": name,
        })


def downgrade() -> None:
    op.drop_column("country_reference", "flag_url")
    op.drop_column("country_reference", "flag_emoji")
    op.drop_column("country_reference", "code")
