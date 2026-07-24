"""Real-Postgres coverage for `_eligible_media_rows`.

Upstream runs this against a shared dev database via a `real_db` fixture this
fork doesn't have. Here it uses the integration suite's `db` fixture, which
migrates a dedicated test database and TRUNCATEs between tests — so unlike
upstream this sees an empty table and can assert the full result set rather
than mere membership.

Lives in tests/integration/ because it exercises actual SQL: the top-level
suite mocks the session (see tests/conftest.py) and cannot catch a missing
`deleted_at IS NULL` filter.
"""

from datetime import datetime, timezone

from apps.api.models.asset import (
    Asset,
    AssetType,
    AssetVersion,
    FileType,
    MediaFile,
    ProcessingStatus,
)
from apps.api.tasks.transcode_tasks import _eligible_media_rows


def _asset(db, project, owner, asset_type=AssetType.video):
    a = Asset(project_id=project.id, name="t", asset_type=asset_type, created_by=owner.id)
    db.add(a)
    db.flush()
    return a


def _version(db, asset, owner, status, deleted=False):
    v = AssetVersion(
        asset_id=asset.id,
        version_number=1,
        processing_status=status,
        created_by=owner.id,
    )
    db.add(v)
    db.flush()
    if deleted:
        v.deleted_at = datetime.now(timezone.utc)
        db.flush()
    return v


def _media(db, version, duration_seconds=None):
    mf = MediaFile(
        version_id=version.id,
        file_type=FileType.video,
        original_filename="f.mp4",
        mime_type="video/mp4",
        file_size_bytes=10,
        s3_key_raw=f"raw/{version.id}",
        duration_seconds=duration_seconds,
    )
    db.add(mf)
    db.flush()
    return mf


def test_eligible_media_rows_scopes_to_ready_nondeleted_null_duration_video_or_audio(
    db, make_project
):
    """Only the (video|audio, ready, non-deleted, duration_seconds IS NULL) row
    should come back."""
    project, owner = make_project()

    # eligible: video asset, ready non-deleted version, duration_seconds NULL
    eligible_asset = _asset(db, project, owner, asset_type=AssetType.video)
    eligible_version = _version(db, eligible_asset, owner, status=ProcessingStatus.ready)
    eligible_media = _media(db, eligible_version, duration_seconds=None)

    # excluded: duration already set (the task must stay idempotent)
    filled_asset = _asset(db, project, owner, asset_type=AssetType.video)
    filled_version = _version(db, filled_asset, owner, status=ProcessingStatus.ready)
    filled_media = _media(db, filled_version, duration_seconds=12.5)

    # excluded: image asset
    image_asset = _asset(db, project, owner, asset_type=AssetType.image)
    image_version = _version(db, image_asset, owner, status=ProcessingStatus.ready)
    image_media = _media(db, image_version, duration_seconds=None)

    # excluded: soft-deleted version
    deleted_version_asset = _asset(db, project, owner, asset_type=AssetType.video)
    deleted_version = _version(
        db, deleted_version_asset, owner, status=ProcessingStatus.ready, deleted=True
    )
    deleted_version_media = _media(db, deleted_version, duration_seconds=None)

    # excluded: version not yet ready
    processing_asset = _asset(db, project, owner, asset_type=AssetType.video)
    processing_version = _version(
        db, processing_asset, owner, status=ProcessingStatus.processing
    )
    processing_media = _media(db, processing_version, duration_seconds=None)

    # excluded: soft-deleted ASSET whose version is still alive — asset
    # soft-delete does not cascade, so the query must filter on the asset too
    deleted_asset = _asset(db, project, owner, asset_type=AssetType.video)
    deleted_asset_version = _version(db, deleted_asset, owner, status=ProcessingStatus.ready)
    deleted_asset_media = _media(db, deleted_asset_version, duration_seconds=None)
    deleted_asset.deleted_at = datetime.now(timezone.utc)
    db.flush()

    result_ids = [mf.id for mf, _asset_type in _eligible_media_rows(db)]

    assert result_ids == [eligible_media.id]
    for excluded in (
        filled_media,
        image_media,
        deleted_version_media,
        processing_media,
        deleted_asset_media,
    ):
        assert excluded.id not in result_ids
