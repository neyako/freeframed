from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from apps.api.models.user import RefreshToken, UserStatus
from apps.api.routers import users


def test_owner_deactivates_and_reactivates_editor(db, make_user) -> None:
    owner = make_user()
    owner.is_superadmin = True
    editor = make_user()
    editor.password_hash = "hash"
    token = RefreshToken(
        user_id=editor.id,
        token_hash="a" * 64,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(token)
    db.commit()

    users.deactivate_user(editor.id, db, owner)
    db.refresh(token)
    assert editor.status == UserStatus.deactivated
    assert token.revoked_at is not None

    users.reactivate_user(editor.id, db, owner)
    assert editor.status == UserStatus.active


def test_owner_cannot_lock_themselves_out(db, make_user) -> None:
    owner = make_user()
    owner.is_superadmin = True
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        users.deactivate_user(owner.id, db, owner)

    assert exc_info.value.status_code == 400
