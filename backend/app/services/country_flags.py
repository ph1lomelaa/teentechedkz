"""Attach country flag assets to API response objects by country name.

Roadmaps and universities store `country_name` as a plain string (denormalised),
so we resolve flags via a single lookup against `country_reference` and stamp the
transient attributes `country_flag_emoji` / `country_flag_url` onto the ORM objects
before they are serialised by the `*Out` schemas (from_attributes=True).
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.country_reference import CountryReference


async def flag_map(db: AsyncSession, names: Iterable[str | None]) -> dict[str, tuple[str, str]]:
    """name -> (flag_emoji, flag_url) for the given country names (case-insensitive)."""
    clean = {n.strip() for n in names if n and n.strip()}
    if not clean:
        return {}
    res = await db.execute(
        select(
            CountryReference.country_name,
            CountryReference.flag_emoji,
            CountryReference.flag_url,
        ).where(CountryReference.country_name.in_(clean))
    )
    out: dict[str, tuple[str, str]] = {}
    for name, emoji, url in res.all():
        out[name.strip().lower()] = (emoji or "", url or "")
    return out


def _stamp(obj: Any, emoji: str, url: str) -> None:
    obj.country_flag_emoji = emoji
    obj.country_flag_url = url


async def attach_flags(
    db: AsyncSession,
    objs: Any,
    *,
    name_attr: str = "country_name",
) -> None:
    """Stamp flag attributes onto one object, a list, or None (in place)."""
    if objs is None:
        return
    items = objs if isinstance(objs, (list, tuple)) else [objs]
    if not items:
        return
    fmap = await flag_map(db, (getattr(o, name_attr, None) for o in items))
    for o in items:
        name = getattr(o, name_attr, None)
        emoji, url = fmap.get(name.strip().lower(), ("", "")) if name else ("", "")
        _stamp(o, emoji, url)
