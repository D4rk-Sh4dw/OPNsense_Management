"""In-memory TTL cache + single-flight wrapper for live poll endpoints.

Prevents the CMS from hammering firewalls when multiple frontend tabs auto-refresh
in parallel. Also bounds concurrency so we never open more than N sockets at once.
"""
import asyncio
import time
from typing import Any, Awaitable, Callable, Dict, Tuple


class TTLCache:
    """Async-safe TTL cache with per-key single-flight semantics."""

    def __init__(self, ttl_seconds: float = 4.0):
        self.ttl = ttl_seconds
        self._store: Dict[str, Tuple[float, Any]] = {}
        self._inflight: Dict[str, asyncio.Future] = {}
        self._lock = asyncio.Lock()

    async def get_or_fetch(self, key: str, fetcher: Callable[[], Awaitable[Any]]) -> Any:
        now = time.monotonic()
        entry = self._store.get(key)
        if entry and now - entry[0] < self.ttl:
            return entry[1]

        async with self._lock:
            entry = self._store.get(key)
            if entry and time.monotonic() - entry[0] < self.ttl:
                return entry[1]
            existing = self._inflight.get(key)
            if existing is not None:
                fut = existing
                wait_only = True
            else:
                fut = asyncio.get_event_loop().create_future()
                self._inflight[key] = fut
                wait_only = False

        if wait_only:
            return await fut

        try:
            value = await fetcher()
            self._store[key] = (time.monotonic(), value)
            if not fut.done():
                fut.set_result(value)
            return value
        except Exception as e:
            if not fut.done():
                fut.set_exception(e)
            raise
        finally:
            async with self._lock:
                self._inflight.pop(key, None)


# Module-level singletons
LIVE_CACHE = TTLCache(ttl_seconds=4.0)         # per-firewall live stats
DASHBOARD_CACHE = TTLCache(ttl_seconds=10.0)   # whole dashboard list
POLL_SEMAPHORE = asyncio.Semaphore(8)          # max 8 concurrent firewall polls


async def bounded(coro_factory: Callable[[], Awaitable[Any]]) -> Any:
    """Run a coroutine factory under the global concurrency semaphore."""
    async with POLL_SEMAPHORE:
        return await coro_factory()
