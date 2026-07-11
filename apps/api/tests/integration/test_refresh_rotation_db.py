from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Event
from typing import Protocol
import uuid

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from apps.api.models.user import RefreshToken, User
from apps.api.services.auth_service import (
    _hash_token,
    create_refresh_token,
    decode_token,
    issue_refresh_token,
    rotate_refresh_token,
)


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


def _rotate_then_commit(
    engine: Engine,
    token: str,
    started: Event,
    returned: Event,
    allow_commit: Event,
) -> tuple[uuid.UUID, str] | None:
    with Session(engine) as session:
        started.set()
        result = rotate_refresh_token(session, token)
        returned.set()
        if not allow_commit.wait(timeout=5):
            session.rollback()
            raise TimeoutError("rotation commit gate timed out")
        session.commit()
        return result


def test_concurrent_rotation_waits_for_lock_and_creates_one_replacement(
    migrated_engine: Engine,
    db: Session,
    make_user: UserFactory,
) -> None:
    user_id, old_token, old_token_id = _seed_refresh_token(db, make_user)
    session_a = Session(migrated_engine)
    started = Event()
    returned = Event()
    allow_commit = Event()
    executor = ThreadPoolExecutor(max_workers=1)
    future = None
    result_a = None
    result_b = None
    returned_while_locked = False

    try:
        session_a.query(RefreshToken).filter(
            RefreshToken.id == old_token_id,
        ).with_for_update().one()
        future = executor.submit(
            _rotate_then_commit,
            migrated_engine,
            old_token,
            started,
            returned,
            allow_commit,
        )
        assert started.wait(timeout=5)
        returned_while_locked = returned.wait(timeout=0.5)
        result_a = rotate_refresh_token(session_a, old_token)
        session_a.commit()
        assert returned.wait(timeout=5)
        allow_commit.set()
        result_b = future.result(timeout=5)
    finally:
        allow_commit.set()
        session_a.rollback()
        session_a.close()
        executor.shutdown(wait=False, cancel_futures=True)
        for worker in executor._threads:
            worker.join(timeout=5)
            assert not worker.is_alive(), "rotation worker did not stop"

    with Session(migrated_engine) as verification_session:
        old_row = verification_session.get(RefreshToken, old_token_id)
        active_replacements = verification_session.query(RefreshToken).filter(
            RefreshToken.user_id == user_id,
            RefreshToken.id != old_token_id,
            RefreshToken.revoked_at.is_(None),
        ).all()

    successes = [result for result in (result_a, result_b) if result is not None]
    assert not returned_while_locked, (
        "rotation returned while the old row lock was held; "
        f"successes={len(successes)} active_replacements={len(active_replacements)}"
    )
    assert len(successes) == 1
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
