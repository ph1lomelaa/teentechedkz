"""Redis-backed fixed-window rate limiting (Этап 0.4).

Protects auth endpoints from brute force and invite/recovery spam. Fail-open:
if Redis is unreachable we allow the request (availability over strictness) and
log a warning — a down cache must not lock everyone out of login.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException, Request, status

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis = None


def _get_redis():
    global _redis
    if _redis is None:
        import redis.asyncio as aioredis

        _redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    return _redis


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _hit(key: str, *, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Register one hit. Returns (allowed, retry_after_seconds)."""
    try:
        client = _get_redis()
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, window_seconds)
        if count <= limit:
            return True, 0
        ttl = await client.ttl(key)
        return False, max(ttl, 1)
    except Exception:
        logger.warning("Rate limiter unavailable, failing open for key=%s", key, exc_info=True)
        return True, 0


async def enforce(
    request: Request,
    *,
    bucket: str,
    limit: int,
    window_seconds: int,
    subject: str | None = None,
) -> None:
    """Count this request against `bucket` keyed by client IP (and optional
    `subject`, e.g. an email). Raises 429 when the limit is exceeded."""
    key_subject = subject if subject is not None else client_ip(request)
    key = f"rl:{bucket}:{key_subject}"
    allowed, retry_after = await _hit(key, limit=limit, window_seconds=window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Попробуйте позже.",
            headers={"Retry-After": str(retry_after), "X-Error-Code": "RATE_LIMITED"},
        )


async def reset(*, bucket: str, subject: str) -> None:
    """Clear a counter — e.g. drop the per-email login counter after a success
    so a user who mistyped a few times isn't held back."""
    try:
        await _get_redis().delete(f"rl:{bucket}:{subject}")
    except Exception:
        logger.warning("Rate limiter reset failed for bucket=%s subject=%s", bucket, subject)
