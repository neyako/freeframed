import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from apps.api.models.share import SharePermission

CommentResponseFixture = dict[str, str | bool | None | list[None]]


def _mock_share_link(asset_id: uuid.UUID | None = None) -> MagicMock:
    link = MagicMock()
    link.id = uuid.uuid4()
    link.asset_id = asset_id
    link.folder_id = None
    link.project_id = None
    link.permission = SharePermission.comment
    return link


def _mock_asset(asset_id: uuid.UUID) -> MagicMock:
    asset = MagicMock()
    asset.id = asset_id
    asset.name = "Client Cut.mp4"
    return asset


def _comment_response(
    asset_id: uuid.UUID,
    version_id: uuid.UUID,
) -> CommentResponseFixture:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()),
        "asset_id": str(asset_id),
        "version_id": str(version_id),
        "parent_id": None,
        "author_id": None,
        "guest_author_id": str(uuid.uuid4()),
        "timecode_start": None,
        "timecode_end": None,
        "body": "Looks good",
        "resolved": False,
        "visibility": "public",
        "created_at": now,
        "updated_at": now,
        "author": None,
        "guest_author": None,
        "annotation": None,
        "replies": [],
        "attachments": [],
        "reactions": [],
    }


@patch("apps.api.routers.comments.validate_asset_in_share", create=True)
@patch("apps.api.routers.comments._get_asset")
@patch("apps.api.routers.comments._assemble_comment_response")
@patch("apps.api.routers.comments._fetch_comment_tree_data")
@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_comments_returns_array_for_asset_share(
    mock_session_validate,
    mock_fetch_comment_tree_data,
    mock_assemble_comment_response,
    mock_get_asset,
    mock_validate_asset,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    comment = MagicMock()
    expected = {
        "id": str(uuid.uuid4()),
        "body": "Looks good",
    }

    link = _mock_share_link(asset_id)
    mock_session_validate.return_value = link
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_validate_asset.return_value = None
    mock_db.join.return_value = mock_db
    mock_db.order_by.return_value = mock_db
    mock_db.all.return_value = [comment]
    comment_data = {"comments_by_parent": {}}
    mock_fetch_comment_tree_data.return_value = comment_data
    mock_assemble_comment_response.return_value = expected

    response = client.get("/share/some-token/comments")

    assert response.status_code == 200
    assert response.json() == [expected]
    mock_fetch_comment_tree_data.assert_called_once_with(
        mock_db,
        [comment],
        asset_id=asset_id,
        version_id=None,
        public_only=True,
    )
    mock_assemble_comment_response.assert_called_once_with(comment, comment_data)


@patch("apps.api.routers.comments.validate_asset_in_share", create=True)
@patch("apps.api.routers.comments._get_asset")
@patch("apps.api.routers.comments._assemble_comment_response")
@patch("apps.api.routers.comments._fetch_comment_tree_data")
@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_comments_returns_array_for_folder_or_project_share_asset(
    mock_session_validate,
    mock_fetch_comment_tree_data,
    mock_assemble_comment_response,
    mock_get_asset,
    mock_validate_asset,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    comment = MagicMock()
    expected = {
        "id": str(uuid.uuid4()),
        "body": "Needs one tweak",
    }

    link = _mock_share_link()
    mock_session_validate.return_value = link
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_validate_asset.return_value = None
    mock_db.join.return_value = mock_db
    mock_db.order_by.return_value = mock_db
    mock_db.all.return_value = [comment]
    comment_data = {"comments_by_parent": {}}
    mock_fetch_comment_tree_data.return_value = comment_data
    mock_assemble_comment_response.return_value = expected

    response = client.get(f"/share/some-token/comments?asset_id={asset_id}")

    assert response.status_code == 200
    assert response.json() == [expected]
    mock_fetch_comment_tree_data.assert_called_once_with(
        mock_db,
        [comment],
        asset_id=asset_id,
        version_id=None,
        public_only=True,
    )
    mock_assemble_comment_response.assert_called_once_with(comment, comment_data)


@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_comments_returns_empty_array_without_target_asset(
    mock_session_validate,
    client,
):
    link = _mock_share_link()
    mock_session_validate.return_value = link

    response = client.get("/share/some-token/comments")

    assert response.status_code == 200
    assert response.json() == []


@patch("apps.api.routers.comments._build_comment_response")
@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_comments_requires_valid_password_session(
    mock_session_validate,
    mock_build_comment_response,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    mock_session_validate.side_effect = HTTPException(
        status_code=403,
        detail="Password required",
    )
    mock_db.order_by.return_value = mock_db
    mock_db.all.return_value = [MagicMock()]
    mock_build_comment_response.return_value = {"id": str(uuid.uuid4()), "body": "Hidden"}

    response = client.get("/share/some-token/comments")

    assert response.status_code == 403


@patch("apps.api.routers.comments.validate_asset_in_share", create=True)
@patch("apps.api.routers.comments._get_asset")
@patch("apps.api.routers.comments._build_comment_response")
@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_comments_rejects_asset_outside_share_scope(
    mock_session_validate,
    mock_build_comment_response,
    mock_get_asset,
    mock_validate_asset,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    link = _mock_share_link()
    mock_session_validate.return_value = link
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_validate_asset.side_effect = HTTPException(
        status_code=403,
        detail="Asset is not in the shared items",
    )
    mock_db.order_by.return_value = mock_db
    mock_db.all.return_value = [MagicMock()]
    mock_build_comment_response.return_value = {"id": str(uuid.uuid4()), "body": "Leaked"}

    response = client.get(f"/share/some-token/comments?asset_id={asset_id}")

    assert response.status_code == 403


@patch("apps.api.routers.comments._get_asset")
@patch("apps.api.routers.comments._build_comment_response")
@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_guest_comment_requires_valid_password_session(
    mock_session_validate,
    mock_build_comment_response,
    mock_get_asset,
    client,
):
    asset_id = uuid.uuid4()
    version_id = uuid.uuid4()
    mock_session_validate.side_effect = HTTPException(
        status_code=403,
        detail="Password required",
    )
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_build_comment_response.return_value = _comment_response(asset_id, version_id)

    response = client.post(
        "/share/some-token/comment",
        json={
            "version_id": str(version_id),
            "body": "Looks good",
            "guest_email": "reviewer@example.com",
            "guest_name": "Reviewer",
        },
    )

    assert response.status_code == 403


@patch("apps.api.routers.comments.validate_asset_in_share", create=True)
@patch("apps.api.routers.comments._get_asset")
@patch("apps.api.routers.comments._build_comment_response")
@patch("apps.api.routers.comments.validate_share_link_with_session", create=True)
def test_share_guest_comment_rejects_asset_outside_share_scope(
    mock_session_validate,
    mock_build_comment_response,
    mock_get_asset,
    mock_validate_asset,
    client,
):
    asset_id = uuid.uuid4()
    version_id = uuid.uuid4()
    link = _mock_share_link()
    mock_session_validate.return_value = link
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_validate_asset.side_effect = HTTPException(
        status_code=403,
        detail="Asset is not in the shared items",
    )
    mock_build_comment_response.return_value = _comment_response(asset_id, version_id)

    response = client.post(
        "/share/some-token/comment",
        json={
            "asset_id": str(asset_id),
            "version_id": str(version_id),
            "body": "Looks good",
            "guest_email": "reviewer@example.com",
            "guest_name": "Reviewer",
        },
    )

    assert response.status_code == 403
