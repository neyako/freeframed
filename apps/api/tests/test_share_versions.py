import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from jose import jwt

from apps.api.config import settings
from apps.api.models.asset import AssetType, AssetVersion, MediaFile, ProcessingStatus


def _mock_link(asset_id: uuid.UUID, show_versions: bool) -> MagicMock:
    link = MagicMock()
    link.id = uuid.uuid4()
    link.asset_id = asset_id
    link.folder_id = None
    link.project_id = None
    link.allow_download = False
    link.permission = "view"
    link.show_versions = show_versions
    return link


def _mock_asset(asset_id: uuid.UUID) -> MagicMock:
    asset = MagicMock()
    asset.id = asset_id
    asset.name = "Client Cut.mp4"
    asset.asset_type = AssetType.video
    asset.project_id = uuid.uuid4()
    return asset


def _mock_version(asset_id: uuid.UUID, version_number: int) -> MagicMock:
    version = MagicMock()
    version.id = uuid.uuid4()
    version.asset_id = asset_id
    version.version_number = version_number
    version.processing_status = ProcessingStatus.ready
    version.created_by = uuid.uuid4()
    version.created_at = datetime(2026, 7, version_number, 12, 0, tzinfo=timezone.utc)
    version.deleted_at = None
    return version


def _mock_media_file(version_id: uuid.UUID, processed_key: str) -> MagicMock:
    media_file = MagicMock()
    media_file.version_id = version_id
    media_file.s3_key_processed = processed_key
    media_file.s3_key_raw = f"raw/{version_id}/input.mp4"
    media_file.s3_key_thumbnail = None
    media_file.original_filename = "input.mp4"
    media_file.duration_seconds = 120.0
    return media_file


def _version_query(versions: list[MagicMock]) -> MagicMock:
    query = MagicMock()
    query.filter.return_value = query
    query.order_by.return_value = query
    query.all.return_value = versions
    query.first.return_value = versions[0] if versions else None
    return query


@patch("apps.api.routers.share._validate_asset_in_share")
@patch("apps.api.routers.share._get_asset")
@patch("apps.api.routers.share.validate_share_link_with_session")
def test_share_versions_returns_ready_versions_newest_first_when_enabled(
    mock_validate,
    mock_get_asset,
    mock_validate_in_share,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    older = _mock_version(asset_id, 1)
    newer = _mock_version(asset_id, 2)
    mock_validate.return_value = _mock_link(asset_id, show_versions=True)
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_validate_in_share.return_value = None
    mock_db.query.side_effect = lambda model: _version_query([newer, older])

    response = client.get(f"/share/some-token/versions/{asset_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body] == [str(newer.id), str(older.id)]
    assert [item["version_number"] for item in body] == [2, 1]
    assert all(item["processing_status"] == ProcessingStatus.ready.value for item in body)
    assert body[0]["created_by"] == str(newer.created_by)
    assert body[0]["deleted_at"] is None


@patch("apps.api.routers.share._validate_asset_in_share")
@patch("apps.api.routers.share._get_asset")
@patch("apps.api.routers.share.validate_share_link_with_session")
def test_share_versions_returns_latest_only_when_versions_hidden(
    mock_validate,
    mock_get_asset,
    mock_validate_in_share,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    older = _mock_version(asset_id, 1)
    newer = _mock_version(asset_id, 2)
    mock_validate.return_value = _mock_link(asset_id, show_versions=False)
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_validate_in_share.return_value = None
    mock_db.query.side_effect = lambda model: _version_query([newer, older])

    response = client.get(f"/share/some-token/versions/{asset_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body] == [str(newer.id)]
    assert [item["version_number"] for item in body] == [2]


@patch("apps.api.routers.share._validate_asset_in_share")
@patch("apps.api.routers.share._log_share_activity")
@patch("apps.api.routers.share._get_latest_media_file")
@patch("apps.api.routers.share._get_asset")
@patch("apps.api.routers.share.validate_share_link_with_session")
def test_share_stream_serves_requested_version_when_versions_enabled(
    mock_validate,
    mock_get_asset,
    mock_get_latest_media_file,
    mock_log_activity,
    mock_validate_in_share,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    older = _mock_version(asset_id, 1)
    latest = _mock_version(asset_id, 2)
    older_media = _mock_media_file(older.id, "processed/project/older-version")
    latest_media = _mock_media_file(latest.id, "processed/project/latest-version")
    media_query = MagicMock()
    media_query.filter.return_value = media_query
    media_query.first.return_value = older_media

    mock_validate.return_value = _mock_link(asset_id, show_versions=True)
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_get_latest_media_file.return_value = latest_media
    mock_log_activity.return_value = None
    mock_validate_in_share.return_value = None
    mock_db.query.side_effect = lambda model: _version_query([older]) if model is AssetVersion else media_query

    response = client.get(f"/share/some-token/stream/{asset_id}?version_id={older.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version_id"] == str(older.id)
    token = body["url"].split("token=", 1)[1]
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert payload["pfx"] == "processed/project/older-version"


@patch("apps.api.routers.share._validate_asset_in_share")
@patch("apps.api.routers.share._log_share_activity")
@patch("apps.api.routers.share._get_latest_media_file")
@patch("apps.api.routers.share._get_asset")
@patch("apps.api.routers.share.validate_share_link_with_session")
def test_share_stream_falls_back_to_latest_when_versions_hidden(
    mock_validate,
    mock_get_asset,
    mock_get_latest_media_file,
    mock_log_activity,
    mock_validate_in_share,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    older = _mock_version(asset_id, 1)
    latest = _mock_version(asset_id, 2)
    latest_media = _mock_media_file(latest.id, "processed/project/latest-version")

    mock_validate.return_value = _mock_link(asset_id, show_versions=False)
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_get_latest_media_file.return_value = latest_media
    mock_log_activity.return_value = None
    mock_validate_in_share.return_value = None

    response = client.get(f"/share/some-token/stream/{asset_id}?version_id={older.id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version_id"] == str(latest.id)
    token = body["url"].split("token=", 1)[1]
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert payload["pfx"] == "processed/project/latest-version"
    mock_db.query.assert_not_called()


@patch("apps.api.routers.share._validate_asset_in_share")
@patch("apps.api.routers.share._log_share_activity")
@patch("apps.api.routers.share._get_latest_media_file")
@patch("apps.api.routers.share._get_asset")
@patch("apps.api.routers.share.validate_share_link_with_session")
def test_share_stream_falls_back_to_latest_when_requested_version_is_not_found(
    mock_validate,
    mock_get_asset,
    mock_get_latest_media_file,
    mock_log_activity,
    mock_validate_in_share,
    client,
    mock_db,
):
    asset_id = uuid.uuid4()
    missing_version_id = uuid.uuid4()
    latest = _mock_version(asset_id, 2)
    latest_media = _mock_media_file(latest.id, "processed/project/latest-version")

    mock_validate.return_value = _mock_link(asset_id, show_versions=True)
    mock_get_asset.return_value = _mock_asset(asset_id)
    mock_get_latest_media_file.return_value = latest_media
    mock_log_activity.return_value = None
    mock_validate_in_share.return_value = None
    mock_db.query.side_effect = lambda model: _version_query([])

    response = client.get(f"/share/some-token/stream/{asset_id}?version_id={missing_version_id}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version_id"] == str(latest.id)
    token = body["url"].split("token=", 1)[1]
    payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    assert payload["pfx"] == "processed/project/latest-version"
