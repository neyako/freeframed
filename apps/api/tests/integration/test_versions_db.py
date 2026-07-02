from datetime import datetime, timezone
from unittest.mock import patch

from apps.api.models.asset import (
    Asset,
    AssetType,
    AssetVersion,
    FileType,
    MediaFile,
    ProcessingStatus,
)
from apps.api.models.project import ProjectMember, ProjectRole


def _add_asset(db, project_id, creator_id) -> Asset:
    asset = Asset(
        project_id=project_id,
        name="clip.mov",
        asset_type=AssetType.video,
        created_by=creator_id,
    )
    db.add(asset)
    db.flush()
    return asset


def test_new_version_route_ignores_soft_deleted_higher_version_number(db, make_project) -> None:
    project, owner = make_project()
    owner.is_superadmin = True
    asset = _add_asset(db, project.id, owner.id)
    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=owner.id,
            role=ProjectRole.owner,
            invited_by=owner.id,
        )
    )
    db.add(
        AssetVersion(
            asset_id=asset.id,
            version_number=1,
            processing_status=ProcessingStatus.ready,
            created_by=owner.id,
        )
    )
    db.add(
        AssetVersion(
            asset_id=asset.id,
            version_number=3,
            processing_status=ProcessingStatus.ready,
            created_by=owner.id,
            deleted_at=datetime.now(timezone.utc),
        )
    )
    db.commit()

    from fastapi.testclient import TestClient

    from apps.api.database import get_db
    from apps.api.main import app
    from apps.api.middleware.auth import get_current_user

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: owner
    try:
        with (
            patch("apps.api.main.ensure_bucket_exists"),
            patch(
                "apps.api.routers.assets.create_multipart_upload",
                return_value="upload-123",
            ),
        ):
            with TestClient(app, raise_server_exceptions=False) as client:
                response = client.post(
                    f"/assets/{asset.id}/versions",
                    json={
                        "project_id": str(project.id),
                        "asset_name": "clip.mov",
                        "original_filename": "clip-v2.mov",
                        "mime_type": "video/quicktime",
                        "file_size_bytes": 5 * 1024**3,
                    },
                )
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200, response.text
    response_body = response.json()
    assert response_body["upload_id"] == "upload-123"
    assert response_body["asset_id"] == str(asset.id)
    created_version = (
        db.query(AssetVersion)
        .filter(AssetVersion.id == response_body["version_id"])
        .one()
    )
    assert created_version.version_number == 2
    media_file = db.query(MediaFile).filter(MediaFile.version_id == created_version.id).one()
    assert media_file.file_size_bytes == 5 * 1024**3


def test_media_file_accepts_five_gb_file_size(db, make_project) -> None:
    project, owner = make_project()
    asset = _add_asset(db, project.id, owner.id)
    version = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=ProcessingStatus.ready,
        created_by=owner.id,
    )
    db.add(version)
    db.flush()
    size_bytes = 5 * 1024**3
    media_file = MediaFile(
        version_id=version.id,
        file_type=FileType.video,
        original_filename="master.mov",
        mime_type="video/quicktime",
        file_size_bytes=size_bytes,
        s3_key_raw="raw/master.mov",
    )
    db.add(media_file)
    db.flush()

    saved = db.query(MediaFile).filter(MediaFile.id == media_file.id).first()

    assert saved.file_size_bytes == size_bytes
