import uuid
from unittest.mock import patch

import pytest

from apps.api.main import app
from apps.api.middleware.auth import get_current_user
from apps.api.models.user import User, UserStatus
from apps.api.schemas import auth as auth_schemas


def _user_with_invite_token() -> User:
    return User(
        id=uuid.uuid4(),
        email="pending-user@example.com",
        name="Pending User",
        avatar_url=None,
        password_hash=None,
        status=UserStatus.pending_invite,
        is_superadmin=False,
        email_verified=False,
        invited_by_id=None,
        invite_token="fixed-synthetic-invite-token",
        invite_token_expires_at=None,
        preferences={},
        deleted_at=None,
    )


@pytest.fixture
def authenticated_client(client, test_user):
    app.dependency_overrides[get_current_user] = lambda: test_user
    yield client
    app.dependency_overrides.pop(get_current_user, None)


def test_user_response_excludes_invite_token_and_admin_response_includes_it():
    assert "invite_token" not in auth_schemas.UserResponse.model_fields
    admin_response = getattr(auth_schemas, "AdminUserResponse", None)
    assert admin_response is not None
    assert "invite_token" in admin_response.model_fields


def test_ordinary_user_endpoints_omit_populated_invite_tokens(
    authenticated_client,
    mock_db,
    test_user,
):
    pending_user = _user_with_invite_token()
    test_user.invite_token = "fixed-synthetic-invite-token"
    mock_db.all.return_value = [pending_user]

    me_response = authenticated_client.get("/auth/me")
    batch_response = authenticated_client.get(
        f"/users?ids={pending_user.id}",
    )
    search_response = authenticated_client.get(
        "/users/search?q=pending",
    )

    assert me_response.status_code == 200
    assert "invite_token" not in me_response.json()
    assert batch_response.status_code == 200
    assert all("invite_token" not in user for user in batch_response.json())
    assert search_response.status_code == 200
    assert all("invite_token" not in user for user in search_response.json())


def test_admin_user_list_retains_invite_token(
    authenticated_client,
    mock_db,
    test_user,
):
    pending_user = _user_with_invite_token()
    test_user.is_superadmin = True
    mock_db.all.return_value = [pending_user]

    response = authenticated_client.get("/admin/users")

    assert response.status_code == 200
    assert response.json()[0]["invite_token"] == "fixed-synthetic-invite-token"


def test_admin_invite_response_retains_generated_invite_token(
    authenticated_client,
    mock_db,
    test_user,
):
    test_user.is_superadmin = True
    mock_db.first.return_value = None

    def populate_generated_fields(user: User) -> None:
        user.id = uuid.uuid4()
        user.avatar_url = None
        user.email_verified = False
        user.is_superadmin = False
        user.preferences = {}

    mock_db.refresh.side_effect = populate_generated_fields

    with (
        patch(
            "apps.api.routers.users.secrets.token_urlsafe",
            return_value="fixed-synthetic-invite-token",
        ),
        patch("apps.api.routers.users.get_workspace_name", return_value="Synthetic Workspace"),
        patch("apps.api.routers.users.send_task_safe"),
    ):
        response = authenticated_client.post(
            "/users/invite",
            json={"email": "invited-user@example.com", "name": "Invited User"},
        )

    assert response.status_code == 201
    assert response.json()["invite_token"] == "fixed-synthetic-invite-token"


@pytest.mark.parametrize(
    ("path_template", "payload"),
    [
        ("/users/{user_id}", {"name": "Renamed User"}),
        ("/users/{user_id}/deactivate", None),
        ("/users/{user_id}/reactivate", None),
        ("/admin/users/{user_id}/deactivate", None),
        ("/admin/users/{user_id}/reactivate", None),
        ("/admin/users/{user_id}/role", {"is_admin": False}),
    ],
)
def test_profile_and_admin_mutations_omit_invite_token(
    authenticated_client,
    mock_db,
    test_user,
    path_template,
    payload,
):
    target_user = _user_with_invite_token()
    target_user.status = UserStatus.active
    test_user.is_superadmin = True
    mock_db.first.return_value = target_user

    response = authenticated_client.patch(
        path_template.format(user_id=target_user.id),
        json=payload,
    )

    assert response.status_code == 200
    assert "invite_token" not in response.json()
