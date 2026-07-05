"""Bootstrap a fresh production database.

If the database is empty, create the current SQLAlchemy schema and stamp
Alembic to the current head so later migrations still work.
If tables already exist but Alembic metadata is missing, stamp head only.
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
from pathlib import Path

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
    cfg.set_main_option("script_location", str(ALEMBIC_DIR.resolve()))
    return cfg


async def _table_exists(table_name: str) -> bool:
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"})
        return result.scalar() is not None


async def _create_all() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def _alembic_head() -> str:
    cfg = _alembic_cfg()
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    if not heads:
        raise RuntimeError("No Alembic head revision found")
    if len(heads) > 1:
        raise RuntimeError(f"Expected a single Alembic head, found: {heads}")
    return heads[0]


def _stamp_head(head: str) -> None:
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(ALEMBIC_INI), "stamp", head],
        cwd=str(PROJECT_ROOT),
        check=True,
    )


async def _bootstrap_async() -> None:
    has_students = await _table_exists("students")
    has_alembic_version = await _table_exists("alembic_version")

    if has_students and has_alembic_version:
        return

    if not has_students:
        await _create_all()

    head = _alembic_head()
    _stamp_head(head)


def bootstrap() -> None:
    asyncio.run(_bootstrap_async())


if __name__ == "__main__":
    bootstrap()
