"""
Auth endpoint tests.

The DB is fully mocked; we control what `query().filter().first()` returns
to simulate existing / non-existing users.

Password hashing (passlib/bcrypt) is mocked because the local environment has
a bcrypt version that is incompatible with passlib. The hash/verify logic is
unit-tested separately in test_auth_service.py.
"""
import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from apps.api.config import settings
from apps.api.models.user import UserStatus


_FAKE_HASH = "$2b$12$fakehashforteststhatisnotrealatall00000000000000000000"


def _mock_user(
    email: str = "test@example.com",
    password_hash: str = _FAKE_HASH,
    *,
    email_verified: bool = True,
    status: UserStatus = UserStatus.active,
) -> MagicMock:
    u = MagicMock()
    u.id = uuid.uuid4()
    u.email = email
    u.name = "Test User"
    u.password_hash = password_hash
    u.status = status
    u.avatar_url = None
    u.created_at = datetime.now(timezone.utc)
    u.deleted_at = None
    u.email_verified = email_verified
    u.is_superadmin = False
    u.preferences = {}
    u.invited_by_id = None
    u.invite_token = None
    u.invite_token_expires_at = None
    return u


# Patch bcrypt hashing so tests don't depend on the local bcrypt installation.
_HASH_PATCH = "apps.api.routers.auth.hash_password"
_VERIFY_PATCH = "apps.api.routers.auth.verify_password"
_FORGOT_PASSWORD_DETAIL = "If that email is registered, a reset link has been sent."
_INVITE_ONLY_DETAIL = "Registration is invite-only"


def _assert_auth_cookies(response) -> None:
    cookies = response.headers.get_list("set-cookie")
    assert len(cookies) == 2
    for cookie_name in ("ff_access_token", "ff_refresh_token"):
        cookie = next(value for value in cookies if value.startswith(f"{cookie_name}="))
        assert "HttpOnly" in cookie
        assert "SameSite=lax" in cookie
        if settings.auth_cookie_secure:
            assert "Secure" in cookie
        else:
            assert "Secure" not in cookie


@pytest.mark.parametrize("email_exists", [False, True])
def test_register_is_invite_only_without_touching_user_data(client, mock_db, email_exists):
    existing = _mock_user("duplicate@example.com") if email_exists else None

    def populate_registration_fields(user) -> None:
        user.id = uuid.uuid4()
        user.avatar_url = None
        user.email_verified = False
        user.is_superadmin = False
        user.preferences = {}

    mock_db.refresh.side_effect = populate_registration_fields

    with (
        patch("apps.api.routers.auth.get_user_by_email", return_value=existing) as get_user,
        patch(_HASH_PATCH, return_value=_FAKE_HASH) as hash_password,
    ):
        resp = client.post(
            "/auth/register",
            json={
                "email": "synthetic@example.com",
                "name": "Synthetic User",
                "password": "fixed-test-password",
            },
        )

    assert resp.status_code == 403
    assert resp.json() == {"detail": _INVITE_ONLY_DETAIL}
    get_user.assert_not_called()
    hash_password.assert_not_called()
    mock_db.add.assert_not_called()
    mock_db.flush.assert_not_called()
    mock_db.commit.assert_not_called()
    mock_db.refresh.assert_not_called()


def test_login_success(client, mock_db):
    user = _mock_user("login@example.com")
    mock_db.first.return_value = user

    with (
        patch(_VERIFY_PATCH, return_value=True),
        patch("apps.api.routers.auth.create_access_token", return_value="fixed-access-token"),
        patch("apps.api.routers.auth.issue_refresh_token", return_value="fixed-refresh-token"),
    ):
        resp = client.post(
            "/auth/login",
            json={"email": "login@example.com", "password": "pw123456"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    _assert_auth_cookies(resp)
    mock_db.commit.assert_called_once()


@pytest.mark.parametrize(
    ("user_status", "email_verified"),
    [
        (UserStatus.active, False),
        (UserStatus.pending_verification, False),
        (UserStatus.pending_invite, False),
        (UserStatus.deactivated, True),
    ],
)
def test_login_rejects_accounts_outside_active_verified_state(
    client,
    mock_db,
    user_status,
    email_verified,
):
    user = _mock_user(
        status=user_status,
        email_verified=email_verified,
    )
    mock_db.first.return_value = user

    with (
        patch(_VERIFY_PATCH, return_value=True),
        patch(
            "apps.api.routers.auth.issue_refresh_token",
            return_value="fixed-refresh-token",
        ) as issue_refresh,
        patch("apps.api.routers.auth.set_auth_cookies") as set_cookies,
    ):
        resp = client.post(
            "/auth/login",
            json={"email": user.email, "password": "correct-password"},
        )

    assert resp.status_code == 401
    assert resp.json() == {"detail": "Invalid credentials"}
    assert resp.headers.get_list("set-cookie") == []
    issue_refresh.assert_not_called()
    set_cookies.assert_not_called()
    mock_db.commit.assert_not_called()


def test_login_wrong_password(client, mock_db):
    """POST /auth/login — 401 on wrong password."""
    user = _mock_user("wp@example.com")
    mock_db.first.return_value = user

    with patch(_VERIFY_PATCH, return_value=False):
        resp = client.post(
            "/auth/login",
            json={"email": "wp@example.com", "password": "wrong"},
        )

    assert resp.status_code == 401


def test_login_nonexistent_user(client, mock_db):
    """POST /auth/login — 401 when user not found."""
    mock_db.first.return_value = None

    resp = client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "anypassword"},
    )
    assert resp.status_code == 401


def test_forgot_password_unknown_email_returns_generic_response(client):
    with (
        patch("apps.api.routers.auth.get_user_by_email", return_value=None),
        patch("apps.api.routers.auth.store_password_reset_token") as store_token,
        patch("apps.api.routers.auth.send_task_safe") as send_task,
    ):
        resp = client.post(
            "/auth/forgot-password",
            json={"email": "missing@example.com"},
        )

    assert resp.status_code == 200
    assert resp.json() == {"detail": _FORGOT_PASSWORD_DETAIL}
    store_token.assert_not_called()
    send_task.assert_not_called()


def test_forgot_password_known_user_dispatches_reset_email(client):
    user = _mock_user("known@example.com")

    with (
        patch("apps.api.routers.auth.get_user_by_email", return_value=user),
        patch("apps.api.routers.auth.secrets.token_urlsafe", return_value="reset-token"),
        patch("apps.api.routers.auth.store_password_reset_token") as store_token,
        patch("apps.api.routers.auth.send_task_safe") as send_task,
    ):
        resp = client.post(
            "/auth/forgot-password",
            json={"email": "known@example.com"},
        )

    assert resp.status_code == 200
    assert resp.json() == {"detail": _FORGOT_PASSWORD_DETAIL}
    store_token.assert_called_once_with("reset-token", str(user.id))
    task, to_email, reset_url = send_task.call_args.args
    assert getattr(task, "name", "").endswith("send_password_reset_email")
    assert to_email == user.email
    assert reset_url == "http://localhost:3000/reset-password/reset-token"


def test_forgot_password_deactivated_user_does_not_dispatch_email(client):
    user = _mock_user("disabled@example.com")
    user.status = UserStatus.deactivated

    with (
        patch("apps.api.routers.auth.get_user_by_email", return_value=user),
        patch("apps.api.routers.auth.store_password_reset_token") as store_token,
        patch("apps.api.routers.auth.send_task_safe") as send_task,
    ):
        resp = client.post(
            "/auth/forgot-password",
            json={"email": "disabled@example.com"},
        )

    assert resp.status_code == 200
    assert resp.json() == {"detail": _FORGOT_PASSWORD_DETAIL}
    store_token.assert_not_called()
    send_task.assert_not_called()


def test_reset_password_invalid_token_returns_400(client):
    with patch("apps.api.routers.auth.get_user_id_from_password_reset_token", return_value=None):
        resp = client.post(
            "/auth/reset-password",
            json={"token": "bad-token", "password": "newpassword123"},
        )

    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid or expired reset link"


def test_reset_password_happy_path_sets_password_and_logs_in(client, mock_db):
    user = _mock_user("reset@example.com")

    with (
        patch("apps.api.routers.auth.get_user_id_from_password_reset_token", return_value=str(user.id)),
        patch("apps.api.routers.auth.get_user_by_id", return_value=user),
        patch("apps.api.routers.auth.delete_password_reset_token") as delete_token,
        patch(_HASH_PATCH, return_value="hashed-reset-password"),
        patch("apps.api.routers.auth.revoke_user_refresh_tokens") as revoke_tokens,
        patch("apps.api.routers.auth.issue_refresh_token", return_value="refresh-token"),
        patch("apps.api.routers.auth.create_access_token", return_value="access-token"),
    ):
        resp = client.post(
            "/auth/reset-password",
            json={"token": "reset-token", "password": "newpassword123"},
        )

    assert resp.status_code == 200
    assert resp.json()["access_token"] == "access-token"
    assert resp.json()["refresh_token"] == "refresh-token"
    assert user.password_hash == "hashed-reset-password"
    assert user.email_verified is True
    delete_token.assert_called_once_with("reset-token")
    revoke_tokens.assert_called_once_with(mock_db, user.id)
    mock_db.commit.assert_called_once()


def test_accept_invite_activates_verified_user_and_logs_in(client, mock_db):
    user = _mock_user(
        "invited@example.com",
        password_hash=None,
        status=UserStatus.pending_invite,
        email_verified=False,
    )
    user.invite_token = "fixed-invite-token"
    user.invite_token_expires_at = datetime.now(timezone.utc).replace(year=2099)
    mock_db.first.return_value = user

    with (
        patch(_HASH_PATCH, return_value="fixed-password-hash"),
        patch("apps.api.routers.auth.revoke_user_refresh_tokens") as revoke_tokens,
        patch("apps.api.routers.auth.issue_refresh_token", return_value="fixed-refresh-token"),
        patch("apps.api.routers.auth.create_access_token", return_value="fixed-access-token"),
    ):
        resp = client.post(
            "/auth/accept-invite",
            json={"token": "fixed-invite-token", "password": "fixed-test-password"},
        )

    assert resp.status_code == 200
    assert user.password_hash == "fixed-password-hash"
    assert user.email_verified is True
    assert user.status == UserStatus.active
    assert user.invite_token is None
    assert user.invite_token_expires_at is None
    revoke_tokens.assert_called_once_with(mock_db, user.id)
    mock_db.commit.assert_called_once()
    _assert_auth_cookies(resp)


def test_get_me(client, auth_headers, test_user):
    """GET /auth/me — returns current user profile."""
    resp = client.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == test_user.email


def test_refresh_token(client, mock_db):
    """POST /auth/refresh — valid refresh token returns new access_token."""
    user = _mock_user("ref@example.com")
    mock_db.first.return_value = user

    with patch(
        "apps.api.routers.auth.rotate_refresh_token",
        return_value=(user.id, "fixed-refresh-token"),
    ):
        resp = client.post(
            "/auth/refresh",
            json={"refresh_token": "fixed-old-refresh-token"},
        )

    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_refresh_token_invalid(client, mock_db):
    """POST /auth/refresh — bad token returns 401."""
    resp = client.post("/auth/refresh", json={"refresh_token": "not-a-valid-token"})
    assert resp.status_code == 401


def test_get_me_no_auth(client):
    """GET /auth/me without token should return 401 or 403 (no bearer scheme)."""
    resp = client.get("/auth/me")
    assert resp.status_code in (401, 403)


def test_get_invite_info_includes_workspace_and_inviter(client, mock_db):
    invitee = _mock_user("invitee@example.com")
    invitee.name = "Invitee User"
    invitee.invite_token = "invite-token"
    invitee.invite_token_expires_at = datetime.now(timezone.utc).replace(year=2099)
    inviter = _mock_user("admin@example.com")
    inviter.name = "Admin User"
    invitee.invited_by_id = inviter.id

    from apps.api.models.branding import WorkspaceSettings

    workspace = WorkspaceSettings(id=1, name="Studio")
    mock_db.first.side_effect = [invitee, inviter, workspace]

    resp = client.get("/auth/invite/invite-token")

    assert resp.status_code == 200
    assert resp.json() == {
        "email": "invitee@example.com",
        "name": "Invitee User",
        "org_name": "Studio",
        "inviter_name": "Admin User",
    }


def test_invite_resurrects_soft_deleted_user(client, auth_headers, mock_db, test_user):
    """Re-inviting a soft-deleted email must reuse the row, not re-insert it."""
    from datetime import datetime, timezone
    from unittest.mock import patch, MagicMock
    from apps.api.models.user import UserStatus

    test_user.is_superadmin = True

    deleted = MagicMock()
    deleted.id = uuid.uuid4()
    deleted.email = "gone@example.com"
    deleted.name = "Old Name"
    deleted.avatar_url = None
    deleted.email_verified = False
    deleted.preferences = {}
    deleted.deleted_at = datetime.now(timezone.utc)
    mock_db.first.return_value = deleted

    with patch("apps.api.routers.users.send_task_safe"):
        resp = client.post(
            "/users/invite",
            headers=auth_headers,
            json={"email": "gone@example.com", "name": "Gone"},
        )

    assert resp.status_code == 201
    assert deleted.deleted_at is None
    assert deleted.status == UserStatus.pending_invite
    assert deleted.password_hash is None
    assert deleted.is_superadmin is False
    assert deleted.invite_token is not None
    mock_db.add.assert_not_called()
    mock_db.commit.assert_called_once()
