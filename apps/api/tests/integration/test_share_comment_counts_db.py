"""The share grid's comment badge counts what a guest can read, nothing else."""
from datetime import datetime, timezone

from apps.api.models.asset import Asset, AssetType, AssetVersion, ProcessingStatus
from apps.api.models.comment import Comment
from apps.api.routers.share import _guest_visible_comment_counts


def _asset(db, project, owner) -> Asset:
    asset = Asset(project_id=project.id, name="cut.mov", asset_type=AssetType.video, created_by=owner.id)
    db.add(asset)
    db.flush()
    return asset


def _version(db, asset, owner, number, status=ProcessingStatus.ready) -> AssetVersion:
    version = AssetVersion(asset_id=asset.id, version_number=number, processing_status=status, created_by=owner.id)
    db.add(version)
    db.flush()
    return version


def _comment(db, asset, version, owner, **fields) -> Comment:
    comment = Comment(asset_id=asset.id, version_id=version.id, author_id=owner.id, body="note", **fields)
    db.add(comment)
    db.flush()
    return comment


def test_counts_only_public_live_comments_on_the_newest_ready_version(db, make_project):
    project, owner = make_project()
    asset = _asset(db, project, owner)
    v1 = _version(db, asset, owner, 1)
    v2 = _version(db, asset, owner, 2)
    _version(db, asset, owner, 3, ProcessingStatus.processing)

    _comment(db, asset, v1, owner)  # older version: not on the card
    _comment(db, asset, v2, owner)
    top = _comment(db, asset, v2, owner)
    _comment(db, asset, v2, owner, parent_id=top.id)  # a visible reply counts
    _comment(db, asset, v2, owner, visibility="internal")  # team-only
    _comment(db, asset, v2, owner, deleted_at=datetime.now(timezone.utc))

    assert _guest_visible_comment_counts(db, [asset.id]) == {asset.id: 3}


def test_asset_without_a_ready_version_has_no_count(db, make_project):
    project, owner = make_project()
    asset = _asset(db, project, owner)
    v1 = _version(db, asset, owner, 1, ProcessingStatus.processing)
    _comment(db, asset, v1, owner)

    assert _guest_visible_comment_counts(db, [asset.id]) == {}
    assert _guest_visible_comment_counts(db, []) == {}
