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

from apps.api.models.user import UserStatus


_FAKE_HASH = "$2b$12$fakehashforteststhatisnotrealatall00000000000000000000"


def _mock_user(
    email: str = "test@example.com",
    password_hash: str = _FAKE_HASH,
) -> MagicMock:
    u = MagicMock()
    u.id = uuid.uuid4()
    u.email = email
    u.name = "Test User"
    u.password_hash = password_hash
    u.status = UserStatus.active
    u.avatar_url = None
    u.created_at = datetime.now(timezone.utc)
    u.deleted_at = None
    u.invited_by_id = None
    return u


# Patch bcrypt hashing so tests don't depend on the local bcrypt installation.
_HASH_PATCH = "apps.api.routers.auth.hash_password"
_VERIFY_PATCH = "apps.api.routers.auth.verify_password"
_FORGOT_PASSWORD_DETAIL = "If that email is registered, a reset link has been sent."


def test_register_success(client, mock_db):
    """POST /auth/register — happy path creates a user and returns 201."""
    mock_db.first.return_value = None  # no duplicate email

    def _refresh_side_effect(obj):
        obj.id = uuid.uuid4()
        obj.created_at = datetime.now(timezone.utc)
        obj.deleted_at = None
        obj.avatar_url = None
        obj.status = UserStatus.active
        obj.is_superadmin = False
        obj.email_verified = False
        obj.preferences = {}
        obj.invite_token = None

    mock_db.refresh.side_effect = _refresh_side_effect

    with patch(_HASH_PATCH, return_value=_FAKE_HASH):
        resp = client.post(
            "/auth/register",
            json={"email": "newuser@example.com", "name": "New User", "password": "securepassword"},
        )

    assert resp.status_code == 201
    assert resp.json()["email"] == "newuser@example.com"


def test_register_duplicate_email(client, mock_db):
    """POST /auth/register — returns 400 when email already exists."""
    existing = _mock_user("dup@example.com")
    mock_db.first.return_value = existing

    with patch(_HASH_PATCH, return_value=_FAKE_HASH):
        resp = client.post(
            "/auth/register",
            json={"email": "dup@example.com", "name": "A", "password": "pw123456"},
        )

    assert resp.status_code == 400


def test_login_success(client, mock_db):
    """POST /auth/login — happy path returns access_token."""
    user = _mock_user("login@example.com")
    mock_db.first.return_value = user

    with patch(_VERIFY_PATCH, return_value=True):
        resp = client.post(
            "/auth/login",
            json={"email": "login@example.com", "password": "pw123456"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


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


def test_get_me(client, auth_headers, test_user):
    """GET /auth/me — returns current user profile."""
    resp = client.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["email"] == test_user.email


def test_refresh_token(client, mock_db):
    """POST /auth/refresh — valid refresh token returns new access_token."""
    from datetime import datetime, timedelta, timezone
    from unittest.mock import MagicMock

    from apps.api.services.auth_service import create_refresh_token

    user = _mock_user("ref@example.com")
    refresh = create_refresh_token(str(user.id))
    token_row = MagicMock()
    token_row.user_id = user.id
    token_row.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    token_row.revoked_at = None
    # order: stored refresh-token row lookup, then user lookup
    mock_db.first.side_effect = [token_row, user]

    resp = client.post("/auth/refresh", json={"refresh_token": refresh})
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
