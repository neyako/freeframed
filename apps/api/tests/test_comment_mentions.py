"""@mentions only email people who can open the asset."""
import uuid
from unittest.mock import MagicMock, patch

from apps.api.models.user import UserStatus
from apps.api.routers import comments


def _user(email: str, status: UserStatus = UserStatus.active) -> MagicMock:
    u = MagicMock()
    u.id = uuid.uuid4()
    u.email = email
    u.status = status
    u.deleted_at = None
    u.is_agent = False
    return u


def test_mention_skips_people_without_access_and_deactivated_accounts(mock_db):
    member = _user("member@example.com")
    outsider = _user("outsider@example.com")
    gone = _user("gone@example.com", UserStatus.deactivated)
    users = {u.email: u for u in (member, outsider, gone)}

    comment = MagicMock(author_id=uuid.uuid4())
    asset = MagicMock(project_id=uuid.uuid4(), id=uuid.uuid4())
    body = "see @member@example.com @outsider@example.com @gone@example.com"

    with (
        patch("apps.api.services.auth_service.get_user_by_email", side_effect=lambda db, email: users[email]),
        patch.object(comments, "can_access_asset", side_effect=lambda db, asset, user: user is not outsider),
        patch.object(comments, "get_workspace_name", return_value="ws"),
        patch.object(comments, "send_task_safe") as send,
    ):
        comments._send_mention_emails(mock_db, comment, asset, body, "Author")

    assert [call.kwargs["to_email"] for call in send.call_args_list] == ["member@example.com"]
