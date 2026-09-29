"""Fold existing "draft 1 - X", "draft 2 - X", ... assets into one asset X.

Each group's earliest draft keeps its versions and becomes "X"; later drafts'
versions move onto it in draft order (so draft 3 becomes the next version),
along with their comments, approvals and share links. The emptied drafts are
soft-deleted. A lone "draft 1 - X" is just renamed to "X".

Dry run by default: prints the plan and changes nothing. Pass --apply to write.

Usage (all-in-one container):
    docker exec <container> python -m apps.api.scripts.merge_draft_assets
    docker exec <container> python -m apps.api.scripts.merge_draft_assets --apply
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

from datetime import datetime, timezone

from sqlalchemy import func

from apps.api.database import SessionLocal
from apps.api.models.asset import Asset, AssetVersion
from apps.api.models.approval import Approval
from apps.api.models.comment import Comment
from apps.api.models.share import ShareLink
from apps.api.services.drafts import plan_draft_merges


def merge(db, apply: bool) -> int:
    assets = db.query(Asset).filter(Asset.deleted_at.is_(None)).all()
    plans = plan_draft_merges(assets)
    now = datetime.now(timezone.utc)

    for target, sources, name in plans:
        print(f'"{target.name}" -> "{name}"')
        # Past every existing number, deleted versions included: the unique
        # (asset_id, version_number) constraint covers them too.
        next_number = (
            db.query(func.max(AssetVersion.version_number))
            .filter(AssetVersion.asset_id == target.id)
            .scalar()
            or 0
        ) + 1
        for source in sources:
            versions = (
                db.query(AssetVersion)
                .filter(AssetVersion.asset_id == source.id, AssetVersion.deleted_at.is_(None))
                .order_by(AssetVersion.version_number)
                .all()
            )
            for version in versions:
                print(f'    "{source.name}" v{version.version_number} -> v{next_number}')
                db.query(Comment).filter(Comment.version_id == version.id).update(
                    {Comment.asset_id: target.id}, synchronize_session=False
                )
                db.query(Approval).filter(Approval.version_id == version.id).update(
                    {Approval.asset_id: target.id}, synchronize_session=False
                )
                version.asset_id = target.id
                version.version_number = next_number
                next_number += 1
                db.flush()
            db.query(ShareLink).filter(ShareLink.asset_id == source.id).update(
                {ShareLink.asset_id: target.id}, synchronize_session=False
            )
            source.deleted_at = now
        target.name = name

    if apply:
        db.commit()
        print(f"Applied {len(plans)} merge(s).")
    else:
        db.rollback()
        print(f"Dry run: {len(plans)} merge(s) planned. Re-run with --apply to write.")
    return len(plans)


if __name__ == "__main__":
    session = SessionLocal()
    try:
        merge(session, apply="--apply" in sys.argv[1:])
    finally:
        session.close()
