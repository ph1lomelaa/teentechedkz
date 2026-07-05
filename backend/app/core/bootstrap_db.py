"""Bootstrap a fresh production database.

If the database is empty, create the current SQLAlchemy schema and stamp
Alembic to the current head so later migrations still work.
If tables already exist but Alembic metadata is missing, stamp head only.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text

import app.models  # noqa: F401 - register metadata
from app.core.database import Base, engine

PROJECT_ROOT = Path(__file__).resolve().parents[3]
ALEMBIC_INI = PROJECT_ROOT / "alembic.ini"
ALEMBIC_DIR = PROJECT_ROOT / "alembic"


def _alembic_cfg() -> Config:
    cfg = Config(str(ALEMBIC_INI))
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    return cfg


async def _table_exists(table_name: str) -> bool:
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"})
        return result.scalar() is not None


async def bootstrap() -> None:
    has_students = await _table_exists("students")
    has_alembic_version = await _table_exists("alembic_version")

    if has_students and has_alembic_version:
        return

    cfg = _alembic_cfg()
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    if not heads:
        raise RuntimeError("No Alembic head revision found")
    if len(heads) > 1:
        raise RuntimeError(f"Expected a single Alembic head, found: {heads}")
    head = heads[0]

    if not has_students:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    command.stamp(cfg, head)


if __name__ == "__main__":
    asyncio.run(bootstrap())
