"""In-process WebSocket hub.

Prod runs a single uvicorn worker, so an in-memory fan-out (user_id → sockets)
is enough — no Redis. Matches the donor platform's Redis-less fallback mode.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._active: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

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

    async def send_to_users(self, user_ids: list[str], event: str, data: dict) -> None:
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


manager = ConnectionManager()
