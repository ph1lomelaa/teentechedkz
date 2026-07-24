"""Shared arq (Redis-backed) job queue — lets request handlers hand off slow,
blocking work (external STT/LLM calls) to the separate `worker` process
instead of doing it inline and holding up the single web event loop."""
from __future__ import annotations

from arq import ArqRedis, create_pool
from arq.connections import RedisSettings

from app.core.config import settings

_pool: ArqRedis | None = None


async def get_arq_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    return _pool
