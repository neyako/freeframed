import uuid
from unittest.mock import patch

from apps.api.config import settings
from apps.api.models.user import UserStatus


def test_initial_setup_creates_verified_superadmin_and_logs_in(client, mock_db):
    mock_db.first.side_effect = [None, None]
    mock_db.flush.side_effect = lambda: setattr(
        mock_db.add.call_args.args[0],
        "id",
        uuid.uuid4(),
    )

    with (
        patch.object(settings, "setup_token", "fixed-setup-token"),
        patch("apps.api.middleware.rate_limit.check_rate_limit", return_value=(True, 0)),
        patch("apps.api.routers.setup.hash_password", return_value="fixed-password-hash"),
        patch("apps.api.routers.setup.create_access_token", return_value="fixed-access-token"),
        patch("apps.api.routers.setup.issue_refresh_token", return_value="fixed-refresh-token"),
    ):
        response = client.post(
            "/setup/create-superadmin",
            json={
                "email": "setup-admin@example.com",
                "name": "Setup Admin",
                "password": "fixed-test-password",
                "setup_token": "fixed-setup-token",
            },
        )

    created_user = mock_db.add.call_args.args[0]
    assert response.status_code == 201
    assert created_user.status == UserStatus.active
    assert created_user.email_verified is True
    assert created_user.is_superadmin is True
    assert created_user.password_hash == "fixed-password-hash"
    assert response.json()["user_id"] == str(created_user.id)
    assert mock_db.commit.call_count == 1
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
