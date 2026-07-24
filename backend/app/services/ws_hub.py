"""WebSocket hub with Redis-backed fan-out.

Each uvicorn worker process only holds the sockets connected *to it* — there
is no way for one process to reach into another process's memory. Once the
web tier runs more than one worker (`uvicorn --workers N`), a plain in-memory
dict (the old design) silently drops pushes to any user whose socket landed
on a different worker. Publishing through Redis instead means every worker
subscribes to the same channel and each delivers to whichever of its own
locally-held sockets match — the message reaches the right user regardless of
which process is holding their connection.

Falls back to local-only delivery if Redis is unreachable (availability over
strictness, same stance as app.services.rate_limit)."""
from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis
from fastapi import WebSocket

from app.core.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "ws:fanout"


class ConnectionManager:
    def __init__(self) -> None:
        self._active: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()
        self._redis: aioredis.Redis | None = None
        self._listen_task: asyncio.Task | None = None

    def _get_redis(self) -> aioredis.Redis:
        if self._redis is None:
            self._redis = aioredis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
        return self._redis

    async def start(self) -> None:
        """Starts the background subscriber that delivers fan-out messages —
        published by any worker process, including this one — to sockets
        held locally. Call once per process at app startup."""
        if self._listen_task is not None:
            return
        self._listen_task = asyncio.create_task(self._listen_loop())

    async def stop(self) -> None:
        if self._listen_task is not None:
            self._listen_task.cancel()
            self._listen_task = None
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    async def _listen_loop(self) -> None:
        while True:
            try:
                pubsub = self._get_redis().pubsub()
                await pubsub.subscribe(CHANNEL)
                async for message in pubsub.listen():
                    if message.get("type") != "message":
                        continue
                    try:
                        payload = json.loads(message["data"])
                        await self._deliver_local(payload["user_ids"], payload["event"], payload["data"])
                    except Exception:
                        logger.exception("ws_hub: failed to handle fan-out message")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("ws_hub: pubsub listener crashed, retrying in 3s")
                await asyncio.sleep(3)

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._active.setdefault(user_id, set()).add(ws)

    async def disconnect(self, user_id: str, ws: WebSocket) -> None:
        async with self._lock:
            conns = self._active.get(user_id)
            if conns:
                conns.discard(ws)
                if not conns:
                    self._active.pop(user_id, None)

    async def _deliver_local(self, user_ids: list[str], event: str, data: dict) -> None:
        payload = {"event": event, "data": data}
        # snapshot to avoid mutation during iteration
        targets: list[WebSocket] = []
        for uid in set(user_ids):
            targets.extend(self._active.get(uid, set()))
        for ws in targets:
            try:
                await ws.send_json(payload)
            except Exception:
                logger.debug("ws send failed; socket will be cleaned up on disconnect")

    async def send_to_users(self, user_ids: list[str], event: str, data: dict) -> None:
        message = json.dumps({"user_ids": list(user_ids), "event": event, "data": data})
        try:
            await self._get_redis().publish(CHANNEL, message)
        except Exception:
            logger.warning("ws_hub: Redis publish failed, falling back to local-only delivery")
            await self._deliver_local(user_ids, event, data)


manager = ConnectionManager()
