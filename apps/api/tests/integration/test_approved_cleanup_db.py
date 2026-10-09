from datetime import datetime, timedelta, timezone

from apps.api.models.approval import Approval, ApprovalStatus
from apps.api.models.asset import Asset, AssetType, AssetVersion, ProcessingStatus
from apps.api.models.comment import Comment
from apps.api.routers.folders import restore_asset
from apps.api.routers.me import list_my_assets
from apps.api.tasks.purge_tasks import trash_approved_assets


def _asset(db, project, owner, name, *decisions):
    """An asset untouched for 40 days, one version per decision: (status or None, days since it was made)."""
    touched = datetime.now(timezone.utc) - timedelta(days=40)
    asset = Asset(
        project_id=project.id, name=name, asset_type=AssetType.video, created_by=owner.id,
        created_at=touched, updated_at=touched,
    )
    db.add(asset)
    db.flush()
    for number, (status, days) in enumerate(decisions, start=1):
        version = AssetVersion(
            asset_id=asset.id,
            version_number=number,
            processing_status=ProcessingStatus.ready,
            created_by=owner.id,
        )
        db.add(version)
        db.flush()
        if status is not None:
            db.add(Approval(
                asset_id=asset.id,
                version_id=version.id,
                user_id=owner.id,
                status=status,
                created_at=datetime.now(timezone.utc) - timedelta(days=days),
            ))
    db.flush()
    return asset


def test_approved_assets_leave_recents_and_reach_the_trash_after_30_days(db, make_project) -> None:
    project, owner = make_project()
    owner.is_superadmin = True
    approved_long_ago = _asset(db, project, owner, "old", (ApprovalStatus.approved, 31))
    approved_recently = _asset(db, project, owner, "fresh", (ApprovalStatus.approved, 2))
    new_version_since = _asset(db, project, owner, "v2", (ApprovalStatus.approved, 31), (None, 0))
    rejected = _asset(db, project, owner, "rejected", (ApprovalStatus.rejected, 40))
    db.commit()

    recents = list_my_assets(filter=None, q=None, hide_approved=True, skip=0, limit=20, db=db, current_user=owner)
    assert {a.name for a in recents} == {"v2", "rejected"}

    assert trash_approved_assets(db) == 1
    for asset in (approved_long_ago, approved_recently, new_version_since, rejected):
        db.refresh(asset)
    assert approved_long_ago.deleted_at is not None
    assert approved_recently.deleted_at is None
    assert new_version_since.deleted_at is None
    assert rejected.deleted_at is None


def test_a_fresh_comment_or_cut_postpones_cleanup(db, make_project) -> None:
    project, owner = make_project()
    owner.is_superadmin = True
    quiet = _asset(db, project, owner, "quiet", (ApprovalStatus.approved, 31))
    busy = _asset(db, project, owner, "busy", (ApprovalStatus.approved, 31))
    version = lambda asset: db.query(AssetVersion).filter(AssetVersion.asset_id == asset.id).one()
    long_ago = datetime.now(timezone.utc) - timedelta(days=40)
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    db.add_all([
        Comment(asset_id=quiet.id, version_id=version(quiet).id, author_id=owner.id, body="old note",
                created_at=long_ago, updated_at=long_ago),
        Comment(asset_id=busy.id, version_id=version(busy).id, author_id=owner.id, body="", is_cut=True,
                timecode_start=1, timecode_end=2, created_at=yesterday, updated_at=yesterday),
    ])
    db.commit()

    assert trash_approved_assets(db) == 1
    db.refresh(quiet)
    db.refresh(busy)
    assert quiet.deleted_at is not None
    assert busy.deleted_at is None


def test_a_restored_asset_is_not_trashed_again_the_next_day(db, make_project) -> None:
    project, owner = make_project()
    owner.is_superadmin = True
    asset = _asset(db, project, owner, "old", (ApprovalStatus.approved, 31))
    db.commit()
    assert trash_approved_assets(db) == 1

    restore_asset(asset.id, db=db, current_user=owner)

    assert trash_approved_assets(db, now=datetime.now(timezone.utc) + timedelta(days=1)) == 0
