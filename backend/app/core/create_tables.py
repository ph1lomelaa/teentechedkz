"""Create all database tables via SQLAlchemy metadata (dev/MVP startup helper)."""
import asyncio
import logging

from app.core.database import engine, Base
import app.models  # noqa: F401 — registers all models with Base.metadata

logger = logging.getLogger(__name__)


async def create_all_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("All tables created (or already exist).")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(create_all_tables())
