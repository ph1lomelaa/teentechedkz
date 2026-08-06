"""Canonical country_name → (ISO-3166 alpha-2 code, flag emoji) map.

The donor platform stored `code`, `flag_emoji`, `flag_url` per country and used
`https://flagcdn.com/w320/<code>.png` for the raster flag. We keep names in
Russian (as used across the CRM `country_reference` table), so this map bridges
our display names to flag assets. Used by:
- the seed (`app/core/seed.py`) — to fill flags on fresh/first seed,
- the countries endpoint — to auto-fill flags when a country is created,
- migration 019 — to back-fill existing rows (mapping inlined there, keep in sync).
"""
from __future__ import annotations

FLAG_CDN = "https://flagcdn.com/w320/{code}.png"

# Keys are matched case-insensitively against country_reference.country_name.
# Synonyms point to the same code/emoji so both spellings resolve.
COUNTRY_FLAGS: dict[str, tuple[str, str]] = {
    # --- present in our seed ---
    "венгрия": ("hu", "🇭🇺"),
    "гонконг": ("hk", "🇭🇰"),
    "сша": ("us", "🇺🇸"),
    "соединённые штаты": ("us", "🇺🇸"),
    "корея": ("kr", "🇰🇷"),
    "южная корея": ("kr", "🇰🇷"),
    "китай": ("cn", "🇨🇳"),
    "италия": ("it", "🇮🇹"),
    "германия": ("de", "🇩🇪"),
    "канада": ("ca", "🇨🇦"),
    # --- common study-abroad destinations ---
    "казахстан": ("kz", "🇰🇿"),
    "великобритания": ("gb", "🇬🇧"),
    "англия": ("gb", "🇬🇧"),
    "малайзия": ("my", "🇲🇾"),
    "россия": ("ru", "🇷🇺"),
    "турция": ("tr", "🇹🇷"),
    "япония": ("jp", "🇯🇵"),
    "франция": ("fr", "🇫🇷"),
    "испания": ("es", "🇪🇸"),
    "нидерланды": ("nl", "🇳🇱"),
    "голландия": ("nl", "🇳🇱"),
    "польша": ("pl", "🇵🇱"),
    "чехия": ("cz", "🇨🇿"),
    "австрия": ("at", "🇦🇹"),
    "швейцария": ("ch", "🇨🇭"),
    "австралия": ("au", "🇦🇺"),
    "оаэ": ("ae", "🇦🇪"),
    "объединённые арабские эмираты": ("ae", "🇦🇪"),
    "катар": ("qa", "🇶🇦"),
    "кипр": ("cy", "🇨🇾"),
    "сингапур": ("sg", "🇸🇬"),
    "финляндия": ("fi", "🇫🇮"),
    "швеция": ("se", "🇸🇪"),
    "норвегия": ("no", "🇳🇴"),
    "дания": ("dk", "🇩🇰"),
    "бельгия": ("be", "🇧🇪"),
    "ирландия": ("ie", "🇮🇪"),
    "новая зеландия": ("nz", "🇳🇿"),
}


def flag_for(country_name: str | None) -> tuple[str, str]:
    """Return (flag_emoji, flag_url) for a display name, or ("", "") if unknown."""
    if not country_name:
        return "", ""
    entry = COUNTRY_FLAGS.get(country_name.strip().lower())
    if not entry:
        return "", ""
    code, emoji = entry
    return emoji, FLAG_CDN.format(code=code)


def code_for(country_name: str | None) -> str:
    if not country_name:
        return ""
    entry = COUNTRY_FLAGS.get(country_name.strip().lower())
    return entry[0] if entry else ""
