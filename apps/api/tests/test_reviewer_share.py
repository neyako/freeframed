import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from apps.api.models.asset import AssetType
from apps.api.models.project import ProjectRole
from apps.api.models.share import SharePermission


def _mock_asset(asset_id: uuid.UUID, project_id: uuid.UUID, created_by: uuid.UUID) -> MagicMock:
    asset = MagicMock()
    asset.id = asset_id
    asset.project_id = project_id
    asset.created_by = created_by
    asset.name = "Client Cut v1.mp4"
    asset.description = None
    asset.asset_type = AssetType.video
    asset.deleted_at = None
    return asset


def _mock_member(project_id: uuid.UUID, user_id: uuid.UUID, role: ProjectRole) -> MagicMock:
    member = MagicMock()
    member.id = uuid.uuid4()
    member.project_id = project_id
    member.user_id = user_id
    member.role = role
    member.deleted_at = None
    return member


def _added_share_link(mock_db: MagicMock):
    for call in mock_db.add.call_args_list:
        obj = call.args[0]
        if obj.__class__.__name__ == "ShareLink":
            return obj
    raise AssertionError("ShareLink was not added")


def test_create_reviewer_share_defaults_to_safe_asset_scope(
    client,
    auth_headers,
    mock_db,
    test_user,
):
    asset_id = uuid.uuid4()
    project_id = uuid.uuid4()
    asset = _mock_asset(asset_id, project_id, test_user.id)
    member = _mock_member(project_id, test_user.id, ProjectRole.editor)
    mock_db.first.side_effect = [asset, member]

    response = client.post(
        f"/assets/{asset_id}/reviewer-share",
        json={},
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    link = _added_share_link(mock_db)
    assert body["asset_id"] == str(asset_id)
    assert body["permission"] == SharePermission.comment.value
    assert body["allow_download"] is False
    assert body["url"] == f"http://localhost:3000/share/{body['token']}"
    assert link.asset_id == asset_id
    assert link.folder_id is None
    assert link.project_id is None
    assert link.show_versions is False
    assert link.visibility == "public"
    assert link.allow_download is False


def test_create_reviewer_share_can_opt_into_download(
    client,
    auth_headers,
    mock_db,
    test_user,
):
    asset_id = uuid.uuid4()
    project_id = uuid.uuid4()
    asset = _mock_asset(asset_id, project_id, test_user.id)
    member = _mock_member(project_id, test_user.id, ProjectRole.editor)
    mock_db.first.side_effect = [asset, member]

    response = client.post(
        f"/assets/{asset_id}/reviewer-share",
        json={"allow_download": True},
        headers=auth_headers,
    )

    assert response.status_code == 201
    body = response.json()
    link = _added_share_link(mock_db)
    assert body["allow_download"] is True
    assert link.allow_download is True
    assert link.folder_id is None
    assert link.project_id is None
    assert link.show_versions is False


def test_create_reviewer_share_defaults_permission_to_comment(
    client,
    auth_headers,
    mock_db,
    test_user,
):
    asset_id = uuid.uuid4()
    project_id = uuid.uuid4()
    asset = _mock_asset(asset_id, project_id, test_user.id)
    member = _mock_member(project_id, test_user.id, ProjectRole.editor)
    mock_db.first.side_effect = [asset, member]

    response = client.post(
        f"/assets/{asset_id}/reviewer-share",
        json={},
        headers=auth_headers,
    )

    assert response.status_code == 201
    link = _added_share_link(mock_db)
    assert response.json()["permission"] == SharePermission.comment.value
    assert link.permission == SharePermission.comment


def test_create_reviewer_share_rejects_non_editor(
    client,
    auth_headers,
    mock_db,
    test_user,
):
    asset_id = uuid.uuid4()
    project_id = uuid.uuid4()
    asset = _mock_asset(asset_id, project_id, test_user.id)
    member = _mock_member(project_id, test_user.id, ProjectRole.reviewer)
    mock_db.first.side_effect = [asset, member]

    response = client.post(
        f"/assets/{asset_id}/reviewer-share",
        json={},
        headers=auth_headers,
    )

    assert response.status_code == 403


def test_reviewer_share_token_resolves_to_single_asset(
    client,
    auth_headers,
    mock_db,
    test_user,
):
    asset_id = uuid.uuid4()
    project_id = uuid.uuid4()
    asset = _mock_asset(asset_id, project_id, test_user.id)
    member = _mock_member(project_id, test_user.id, ProjectRole.editor)
    mock_db.first.side_effect = [asset, member]

    create_response = client.post(
        f"/assets/{asset_id}/reviewer-share",
        json={},
        headers=auth_headers,
    )

    assert create_response.status_code == 201
    link = _added_share_link(mock_db)
    link.id = uuid.uuid4()
    link.description = None
    link.is_enabled = True
    link.password_hash = None
    link.appearance = {}
    link.created_at = datetime.now(timezone.utc)
    link.deleted_at = None
    mock_db.first.side_effect = [link, asset, None, None, None]

    validate_response = client.get(f"/share/{link.token}")

    assert validate_response.status_code == 200
    body = validate_response.json()
    assert body["asset_id"] == str(asset_id)
    assert body["folder_id"] is None
    assert body["project_id"] is None
    assert body["show_versions"] is False
