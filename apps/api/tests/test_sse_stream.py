"""The SSE stream waits when idle, delivers events, and ends once access is gone."""
import asyncio
import json
import uuid
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from apps.api.models.user import UserStatus
from apps.api.routers import events
from apps.api.services import event_service


class _PubSub:
    def __init__(self, messages=()):
        self.messages = list(messages)
        self.timeouts: list[float] = []

    async def subscribe(self, channel):
        pass

    async def unsubscribe(self, channel):
        pass

    async def aclose(self):
        pass

    async def get_message(self, ignore_subscribe_messages=False, timeout=0.0):
        self.timeouts.append(timeout)
        if self.messages:
            return self.messages.pop(0)
        await asyncio.sleep(timeout)  # what a real blocking read does
        return None


def _run(pubsub, consume):
    """Run `consume(stream_factory)` with the Redis connection replaced by `pubsub`."""
    redis = MagicMock()
    redis.pubsub.return_value = pubsub
    with patch.object(event_service, "_get_redis", return_value=redis):
        return asyncio.run(asyncio.wait_for(consume(event_service.event_stream), 5))


def test_an_idle_stream_waits_and_ends_when_access_is_revoked():
    pubsub = _PubSub()
    checks = 0

    async def allowed():
        nonlocal checks
        checks += 1
        return checks < 3

    async def drain(event_stream):
        return [chunk async for chunk in event_stream("p1", allowed, recheck_seconds=0.05)]

    assert _run(pubsub, drain) == []  # no keepalive flood
    assert checks == 3
    # Every read waited for something. The default timeout of 0 returns at once,
    # which made the old loop spin: tens of thousands of keepalives a second.
    assert len(pubsub.timeouts) < 15
    assert max(pubsub.timeouts) > 0.01


def test_an_event_is_formatted_for_the_client():
    message = {"type": "message", "data": json.dumps({"type": "transcode_complete", "payload": {"asset_id": "a1"}})}

    async def first(event_stream):
        return await anext(event_stream("p1"))

    assert _run(_PubSub([message]), first) == 'event: transcode_complete\ndata: {"asset_id": "a1"}\n\n'


def _listener(user, role_error=None):
    db = MagicMock()
    with (
        patch.object(events, "SessionLocal", return_value=db),
        patch.object(events, "get_user_by_id", return_value=user),
        patch.object(events, "require_project_role", side_effect=role_error),
    ):
        return events._may_still_listen(uuid.uuid4(), uuid.uuid4()), db


def test_a_member_may_keep_listening():
    allowed, db = _listener(MagicMock(status=UserStatus.active))
    assert allowed is True
    db.close.assert_called_once()


def test_a_removed_member_a_deactivated_account_and_a_deleted_user_may_not():
    assert _listener(MagicMock(status=UserStatus.active), HTTPException(status_code=403))[0] is False
    assert _listener(MagicMock(status=UserStatus.deactivated))[0] is False
    assert _listener(None)[0] is False
