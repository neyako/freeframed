import importlib
import uuid
from dataclasses import dataclass, field
from types import ModuleType
from unittest.mock import MagicMock

import pytest

from apps.api.models.asset import AssetType, FileType, ProcessingStatus
from apps.api.models.share import SharePermission
from apps.api.schemas.upload import MAX_FILE_SIZE_BYTES


INTEGRATION_API_KEY = "test-integration-key"
VIDEO_BYTES = b"tiny fake mp4 payload"


@dataclass(frozen=True, slots=True)
class IngestRequest:
    project_id: uuid.UUID
    api_key: str | None = INTEGRATION_API_KEY
    mime_type: str = "video/mp4"


@dataclass(slots=True)
class IngestSideEffects:
    uploaded_keys: list[str] = field(default_factory=list)
    uploaded_content_types: list[str | None] = field(default_factory=list)
    triggered_assets: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    share_created_by: uuid.UUID | None = None
    share_permission: SharePermission | None = None
    share_allow_download: bool | None = None


def _integrations_module() -> ModuleType | None:
    try:
        return importlib.import_module("apps.api.routers.integrations")
    except ModuleNotFoundError as exc:
        if exc.name == "apps.api.routers.integrations":
            return None
        raise


def _set_integration_key(monkeypatch: pytest.MonkeyPatch, value: str | None) -> None:
    if value is None:
        monkeypatch.delenv("INTEGRATION_API_KEY", raising=False)
    else:
        monkeypatch.setenv("INTEGRATION_API_KEY", value)

    from apps.api.config import settings

    if hasattr(settings, "integration_api_key"):
        monkeypatch.setattr(settings, "integration_api_key", value)


def _mock_project(project_id: uuid.UUID, owner_id: uuid.UUID) -> MagicMock:
    project = MagicMock()
    project.id = project_id
    project.created_by = owner_id
    project.deleted_at = None
    return project


def _assign_ids_on_flush(mock_db: MagicMock) -> None:
    def flush() -> None:
        for call in mock_db.add.call_args_list:
            obj = call.args[0]
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()

    def refresh(obj: object) -> None:
        if getattr(obj, "id", None) is None:
            setattr(obj, "id", uuid.uuid4())

    mock_db.flush.side_effect = flush
    mock_db.refresh.side_effect = refresh


def _patch_integration_side_effects(
    monkeypatch: pytest.MonkeyPatch,
) -> IngestSideEffects:
    calls = IngestSideEffects()
    module = _integrations_module()
    if module is None:
        return calls

    from apps.api.routers.share import (
        create_reviewer_share as real_create_reviewer_share,
    )

    def upload_fileobj(
        s3_key: str, fileobj: object, content_type: str | None = None
    ) -> None:
        assert not isinstance(fileobj, bytes | bytearray)
        assert hasattr(fileobj, "read")
        calls.uploaded_keys.append(s3_key)
        calls.uploaded_content_types.append(content_type)

    def trigger_processing(asset_id: uuid.UUID, version_id: uuid.UUID) -> None:
        calls.triggered_assets.append((asset_id, version_id))

    def create_reviewer_share(
        db,
        asset,
        created_by: uuid.UUID,
        permission: SharePermission = SharePermission.comment,
        allow_download: bool = False,
        expires_at=None,
        password=None,
        title=None,
    ):
        calls.share_created_by = created_by
        calls.share_permission = permission
        calls.share_allow_download = allow_download
        return real_create_reviewer_share(
            db,
            asset=asset,
            created_by=created_by,
            permission=permission,
            allow_download=allow_download,
            expires_at=expires_at,
            password=password,
            title=title,
        )

    monkeypatch.setattr(module, "upload_fileobj", upload_fileobj)
    monkeypatch.setattr(module, "_trigger_processing", trigger_processing)
    monkeypatch.setattr(module, "create_reviewer_share", create_reviewer_share)
    return calls


def _post_review_ingest(client, request: IngestRequest):
    headers = {}
    if request.api_key is not None:
        headers["X-Api-Key"] = request.api_key

    return client.post(
        "/integrations/review-ingest",
        data={
            "project_id": str(request.project_id),
            "asset_name": "Client Cut v1",
            "mime_type": request.mime_type,
        },
        files={"file": ("client-cut-v1.mp4", VIDEO_BYTES, request.mime_type)},
        headers=headers,
    )


def _added_model(mock_db: MagicMock, model_name: str):
    for call in mock_db.add.call_args_list:
        obj = call.args[0]
        if obj.__class__.__name__ == model_name:
            return obj
    raise AssertionError(f"{model_name} was not added")


def _fail_if_body_is_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail_parse(*args, **kwargs):
        raise AssertionError("unauthorized review ingest must not parse multipart body")

    monkeypatch.setattr("starlette.requests.Request.form", fail_parse)
    monkeypatch.setattr("starlette.requests.Request.body", fail_parse)


def test_review_ingest_returns_503_when_server_key_unset(client, monkeypatch, mock_db):
    _set_integration_key(monkeypatch, None)
    _fail_if_body_is_parsed(monkeypatch)

    response = _post_review_ingest(client, IngestRequest(project_id=uuid.uuid4()))

    assert response.status_code == 503
    mock_db.query.assert_not_called()


@pytest.mark.parametrize("api_key", [None, "wrong-key"])
def test_review_ingest_rejects_missing_or_wrong_api_key(
    client, monkeypatch, mock_db, api_key
):
    _set_integration_key(monkeypatch, INTEGRATION_API_KEY)
    _fail_if_body_is_parsed(monkeypatch)

    response = _post_review_ingest(
        client, IngestRequest(project_id=uuid.uuid4(), api_key=api_key)
    )

    assert response.status_code == 401
    mock_db.query.assert_not_called()


def test_review_ingest_creates_asset_version_media_and_reviewer_share(
    client,
    monkeypatch,
    mock_db,
):
    project_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    mock_db.first.return_value = _mock_project(project_id, owner_id)
    _assign_ids_on_flush(mock_db)
    _set_integration_key(monkeypatch, INTEGRATION_API_KEY)
    side_effects = _patch_integration_side_effects(monkeypatch)

    async def fail_uploadfile_read(self, size: int = -1) -> bytes:
        raise AssertionError(
            "review ingest must stream UploadFile.file without calling read()"
        )

    monkeypatch.setattr(
        "starlette.datastructures.UploadFile.read", fail_uploadfile_read
    )

    response = _post_review_ingest(client, IngestRequest(project_id=project_id))

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {
        "asset_id",
        "version_id",
        "version_number",
        "token",
        "url",
        "expires_at",
    }
    assert body["version_number"] == 1
    assert body["url"].endswith(f"/share/{body['token']}")

    asset = _added_model(mock_db, "Asset")
    version = _added_model(mock_db, "AssetVersion")
    media_file = _added_model(mock_db, "MediaFile")
    share_link = _added_model(mock_db, "ShareLink")

    assert asset.project_id == project_id
    assert asset.name == "Client Cut v1"
    assert asset.asset_type == AssetType.video
    assert asset.created_by == owner_id
    assert asset.folder_id is None
    assert version.asset_id == asset.id
    assert version.version_number == 1
    assert version.processing_status == ProcessingStatus.processing
    assert version.created_by == owner_id
    assert media_file.version_id == version.id
    assert media_file.file_type == FileType.video
    assert media_file.original_filename == "client-cut-v1.mp4"
    assert media_file.mime_type == "video/mp4"
    assert media_file.file_size_bytes == len(VIDEO_BYTES)
    assert media_file.s3_key_raw == side_effects.uploaded_keys[0]
    assert side_effects.uploaded_keys == [
        f"raw/{project_id}/{asset.id}/{version.id}/original.mp4",
    ]
    assert side_effects.uploaded_content_types == ["video/mp4"]
    assert side_effects.triggered_assets == [(asset.id, version.id)]
    assert side_effects.share_created_by == owner_id
    assert side_effects.share_permission == SharePermission.comment
    assert side_effects.share_allow_download is False
    assert share_link.asset_id == asset.id
    assert share_link.folder_id is None
    assert share_link.project_id is None
    assert share_link.show_versions is False
    assert body["asset_id"] == str(asset.id)
    assert body["version_id"] == str(version.id)


def test_review_ingest_returns_404_for_unknown_project(client, monkeypatch, mock_db):
    _set_integration_key(monkeypatch, INTEGRATION_API_KEY)
    mock_db.first.return_value = None

    response = _post_review_ingest(client, IngestRequest(project_id=uuid.uuid4()))

    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"
    mock_db.add.assert_not_called()


def test_review_ingest_rejects_unsupported_mime_type(client, monkeypatch, mock_db):
    _set_integration_key(monkeypatch, INTEGRATION_API_KEY)

    response = _post_review_ingest(
        client,
        IngestRequest(project_id=uuid.uuid4(), mime_type="application/zip"),
    )

    assert response.status_code == 400
    mock_db.query.assert_not_called()


def test_review_ingest_rejects_files_over_upload_limit(client, monkeypatch, mock_db):
    project_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    mock_db.first.return_value = _mock_project(project_id, owner_id)
    _set_integration_key(monkeypatch, INTEGRATION_API_KEY)
    monkeypatch.setattr(
        "apps.api.routers.integrations.MAX_FILE_SIZE_BYTES", len(VIDEO_BYTES) - 1
    )
    side_effects = _patch_integration_side_effects(monkeypatch)

    response = _post_review_ingest(client, IngestRequest(project_id=project_id))

    assert MAX_FILE_SIZE_BYTES > len(VIDEO_BYTES)
    assert response.status_code == 400
    assert response.json()["detail"] == "File exceeds 10GB limit"
    mock_db.add.assert_not_called()
    assert side_effects.uploaded_keys == []
