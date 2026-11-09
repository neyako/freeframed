"""Redis-backed SSE event bus for cross-process real-time events."""
import asyncio
import json
from typing import AsyncGenerator, Awaitable, Callable
import redis.asyncio as aioredis
from ..config import settings

_pool = None

# How often an open stream asks whether its viewer may still listen.
ACCESS_RECHECK_SECONDS = 60.0
# Longest gap between two writes to an idle stream: reverse proxies close a
# connection that sends nothing for their read timeout (60 s in the all-in-one nginx).
KEEPALIVE_SECONDS = 25.0


def _get_redis():
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(settings.redis_url, decode_responses=True)
    return aioredis.Redis(connection_pool=_pool)


async def publish(project_id: str, event_type: str, payload: dict) -> None:
    """Publish an event to a Redis channel for the project."""
    r = _get_redis()
    message = json.dumps({"type": event_type, "payload": payload})
    await r.publish(f"project:{project_id}", message)


def _format(data) -> str:
    try:
        parsed = json.loads(data)
        event_type = parsed.get("type", "message")
        payload = json.dumps(parsed.get("payload", parsed))
        return f"event: {event_type}\ndata: {payload}\n\n"
    except (json.JSONDecodeError, TypeError, AttributeError):
        return f"data: {data}\n\n"


async def event_stream(
    project_id: str,
    still_allowed: Callable[[], Awaitable[bool]] | None = None,
    recheck_seconds: float = ACCESS_RECHECK_SECONDS,
) -> AsyncGenerator[str, None]:
    """Subscribe to a Redis channel and yield SSE messages.

    Access is checked when the stream opens; `still_allowed` is asked again every
    `recheck_seconds`, so a viewer who is removed from the project, or whose
    account is deactivated, stops receiving events instead of keeping the stream
    for as long as their tab stays open.
    """
    r = _get_redis()
    pubsub = r.pubsub()
    await pubsub.subscribe(f"project:{project_id}")
    loop = asyncio.get_running_loop()
    last_check = last_sent = loop.time()
    try:
        while True:
            wake_at = last_sent + KEEPALIVE_SECONDS
            if still_allowed is not None:
                wake_at = min(wake_at, last_check + recheck_seconds)
            # get_message's timeout defaults to 0, which returns at once when
            # nothing is waiting. Without an explicit wait this loop spins, writing
            # a keepalive tens of thousands of times a second.
            message = await pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=max(0.0, wake_at - loop.time()),
            )

            if still_allowed is not None and loop.time() - last_check >= recheck_seconds:
                if not await still_allowed():
                    return
                last_check = loop.time()

            if message and message.get("type") == "message":
                yield _format(message["data"])
                last_sent = loop.time()
            elif loop.time() - last_sent >= KEEPALIVE_SECONDS:
                yield ": keepalive\n\n"
                last_sent = loop.time()
    finally:
        await pubsub.unsubscribe(f"project:{project_id}")
        await pubsub.aclose()
