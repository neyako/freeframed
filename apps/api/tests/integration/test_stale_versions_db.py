from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from apps.api.models.asset import Asset, AssetType, AssetVersion, FileType, MediaFile, ProcessingStatus
from apps.api.tasks.purge_tasks import fail_stale_versions

ABORT_TARGET = "apps.api.tasks.purge_tasks.s3_service.abort_multipart_upload"


def _version(db, asset, number, status, age):
    version = AssetVersion(
        asset_id=asset.id,
        version_number=number,
        processing_status=status,
        created_by=asset.created_by,
        created_at=datetime.now(timezone.utc) - age,
    )
    db.add(version)
    db.flush()
    db.add(MediaFile(
        version_id=version.id,
        file_type=FileType.video,
        original_filename="clip.mov",
        mime_type="video/quicktime",
        file_size_bytes=1,
        s3_key_raw=f"raw/{version.id}/original.mov",
        upload_id=f"upload-{number}",
    ))
    return version


def test_fails_day_old_uploads_and_aborts_their_parts(db, make_project) -> None:
    project, owner = make_project()
    asset = Asset(project_id=project.id, name="clip", asset_type=AssetType.video, created_by=owner.id)
    db.add(asset)
    db.flush()
    abandoned = _version(db, asset, 1, ProcessingStatus.uploading, timedelta(days=2))
    stuck = _version(db, asset, 2, ProcessingStatus.processing, timedelta(days=2))
    fresh = _version(db, asset, 3, ProcessingStatus.uploading, timedelta(minutes=5))
    db.commit()

    with patch(ABORT_TARGET) as abort:
        failed = fail_stale_versions(db)

    assert failed == 2
    for version in (abandoned, stuck, fresh):
        db.refresh(version)
    assert abandoned.processing_status == ProcessingStatus.failed
    assert stuck.processing_status == ProcessingStatus.failed
    assert fresh.processing_status == ProcessingStatus.uploading
    abort.assert_called_once_with(f"raw/{abandoned.id}/original.mov", "upload-1")
