from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
from queue import Empty, Queue
from threading import Event
from time import monotonic, sleep
from typing import Protocol
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session

from apps.api.models.user import RefreshToken, User
from apps.api.services.auth_service import (
    _hash_token,
    create_refresh_token,
    decode_token,
    issue_refresh_token,
    rotate_refresh_token,
)

_ROTATION_A_APPLICATION_NAME = "ff078_refresh_a"
_ROTATION_B_APPLICATION_NAME = "ff078_refresh_b"


class UserFactory(Protocol):
    def __call__(
        self,
        email: str | None = None,
        name: str = "Test User",
    ) -> User: ...


def _seed_refresh_token(
    db: Session,
    make_user: UserFactory,
) -> tuple[uuid.UUID, str, uuid.UUID]:
    user = make_user()
    token = issue_refresh_token(db, user.id)
    payload = decode_token(token)
    assert payload is not None
    token_id = uuid.UUID(payload["jti"])
    user_id = user.id
    db.commit()
    return user_id, token, token_id


def _tag_backend(session: Session, application_name: str) -> int:
    row = session.execute(
        text(
            "SELECT set_config('application_name', :name, false) AS name, "
            "pg_backend_pid() AS pid"
        ),
        {"name": application_name},
    ).mappings().one()
    assert row["name"] == application_name
    return int(row["pid"])


def _rotate_then_commit(
    engine: Engine,
    token: str,
    backend_pid_queue: Queue[int],
    returned: Event,
    allow_commit: Event,
) -> tuple[uuid.UUID, str] | None:
    with Session(engine) as session:
        backend_pid_queue.put(_tag_backend(session, _ROTATION_B_APPLICATION_NAME))
        result = rotate_refresh_token(session, token)
        returned.set()
        if not allow_commit.wait(timeout=5):
            session.rollback()
            raise TimeoutError("rotation commit gate timed out")
        session.commit()
        return result


def _wait_for_rotation_lock(
    observer: Connection,
    blocker_pid: int,
    blocked_pid: int,
    returned: Event,
) -> bool:
    blocked_rotation = text(
        """
        WITH blocked AS (
            SELECT
                activity.pid,
                pg_blocking_pids(activity.pid) AS blocking_pids
            FROM pg_stat_activity AS activity
            WHERE activity.datname = current_database()
              AND activity.pid = :blocked_pid
              AND activity.application_name = :blocked_application_name
              AND activity.state = 'active'
              AND activity.wait_event_type = 'Lock'
              AND activity.wait_event = 'transactionid'
              AND activity.query ILIKE '%FROM refresh_tokens%'
              AND activity.query ILIKE '%FOR UPDATE%'
        )
        SELECT true
        FROM blocked
        JOIN pg_locks AS waiting
          ON waiting.pid = blocked.pid
         AND waiting.granted IS FALSE
         AND waiting.locktype = 'transactionid'
         AND waiting.mode = 'ShareLock'
        JOIN pg_locks AS held
          ON held.pid = :blocker_pid
         AND held.granted IS TRUE
         AND held.locktype = 'transactionid'
         AND held.mode = 'ExclusiveLock'
         AND held.transactionid = waiting.transactionid
        WHERE :blocker_pid = ANY(blocked.blocking_pids)
        """
    )
    deadline = monotonic() + 5
    while monotonic() < deadline:
        lock_observed = observer.execute(
            blocked_rotation,
            {
                "blocked_pid": blocked_pid,
                "blocked_application_name": _ROTATION_B_APPLICATION_NAME,
                "blocker_pid": blocker_pid,
            },
        ).scalar_one_or_none()
        if lock_observed is True:
            return True
        assert not returned.is_set(), (
            "rotation returned before PostgreSQL observed its target SELECT "
            "waiting on session A"
        )
        sleep(0.05)
    raise AssertionError(
        "PostgreSQL never observed rotation B waiting on session A's row lock"
    )


def test_concurrent_rotation_waits_for_lock_and_creates_one_replacement(
    migrated_engine: Engine,
    db: Session,
    make_user: UserFactory,
) -> None:
    user_id, old_token, old_token_id = _seed_refresh_token(db, make_user)
    session_a = Session(migrated_engine)
    observer = migrated_engine.connect().execution_options(isolation_level="AUTOCOMMIT")
    backend_pid_queue: Queue[int] = Queue(maxsize=1)
    returned = Event()
    allow_commit = Event()
    executor = ThreadPoolExecutor(max_workers=1)
    future = None
    worker_stopped = True

    try:
        blocker_pid = _tag_backend(session_a, _ROTATION_A_APPLICATION_NAME)
        session_a.query(RefreshToken).filter(
            RefreshToken.id == old_token_id,
        ).with_for_update().one()
        future = executor.submit(
            _rotate_then_commit,
            migrated_engine,
            old_token,
            backend_pid_queue,
            returned,
            allow_commit,
        )
        try:
            blocked_pid = backend_pid_queue.get(timeout=5)
        except Empty as exc:
            raise AssertionError("rotation worker did not publish its backend PID") from exc
        assert blocked_pid != blocker_pid
        assert _wait_for_rotation_lock(observer, blocker_pid, blocked_pid, returned)
        assert not returned.is_set()
        result_a = rotate_refresh_token(session_a, old_token)
        assert result_a is not None
        session_a.commit()
        assert returned.wait(timeout=5)
        allow_commit.set()
        result_b = future.result(timeout=5)
        assert result_b is None
    finally:
        allow_commit.set()
        session_a.rollback()
        session_a.close()
        observer.close()
        if future is not None:
            _, not_done = wait((future,), timeout=5)
            worker_stopped = not not_done
        executor.shutdown(wait=worker_stopped, cancel_futures=True)

    assert worker_stopped, "rotation worker did not stop"

    with Session(migrated_engine) as verification_session:
        old_row = verification_session.get(RefreshToken, old_token_id)
        active_replacements = verification_session.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.id != old_token_id,
            RefreshToken.revoked_at.is_(None),
        ).all()

    assert old_row is not None
    assert old_row.revoked_at is not None
    assert len(active_replacements) == 1
    assert old_row.replaced_by_id == active_replacements[0].id


@pytest.mark.parametrize("token_state", ["expired", "revoked"])
def test_stale_refresh_rows_create_no_replacement(
    db: Session,
    make_user: UserFactory,
    token_state: str,
) -> None:
    user = make_user()
    token_id = uuid.uuid4()
    expires_at = datetime.now(timezone.utc) + timedelta(days=1)
    if token_state == "expired":
        expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    token = create_refresh_token(
        str(user.id),
        token_id=str(token_id),
        expires_at=expires_at,
    )
    db.add(
        RefreshToken(
            id=token_id,
            user_id=user.id,
            token_hash=_hash_token(token),
            expires_at=expires_at,
            revoked_at=(
                datetime.now(timezone.utc)
                if token_state == "revoked"
                else None
            ),
        )
    )
    db.commit()
    row_count = db.query(RefreshToken).count()

    result = rotate_refresh_token(db, token)
    db.flush()

    assert result is None
    assert db.query(RefreshToken).count() == row_count


def test_malformed_refresh_token_creates_no_database_row(
    db: Session,
) -> None:
    row_count = db.query(RefreshToken).count()

    result = rotate_refresh_token(db, "fixed-malformed-refresh-token")
    db.flush()

    assert result is None
    assert db.query(RefreshToken).count() == row_count


def test_rolled_back_rotation_can_retry_cleanly_and_replay_is_rejected(
    migrated_engine: Engine,
    db: Session,
    make_user: UserFactory,
) -> None:
    user_id, old_token, old_token_id = _seed_refresh_token(db, make_user)

    with Session(migrated_engine) as rolled_back_session:
        first_result = rotate_refresh_token(rolled_back_session, old_token)
        assert first_result is not None
        rolled_back_session.rollback()

    with Session(migrated_engine) as retry_session:
        retry_result = rotate_refresh_token(retry_session, old_token)
        assert retry_result is not None
        retry_session.commit()

    with Session(migrated_engine) as replay_session:
        replay_result = rotate_refresh_token(replay_session, old_token)
        replay_session.commit()

    with Session(migrated_engine) as verification_session:
        old_row = verification_session.get(RefreshToken, old_token_id)
        active_replacements = verification_session.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.id != old_token_id,
            RefreshToken.revoked_at.is_(None),
        ).all()

    assert replay_result is None
    assert old_row is not None
    assert old_row.revoked_at is not None
    assert len(active_replacements) == 1
    assert old_row.replaced_by_id == active_replacements[0].id
